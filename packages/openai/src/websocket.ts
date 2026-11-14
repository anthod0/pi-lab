import { isDeepStrictEqual } from "node:util";
import { ResponseOutput, restoreInput, type ReplayRecord } from "./replay";

const ENDPOINT = "https://api.openai.com/v1/responses";
const IDLE_MS = 5 * 60 * 1000;
const MAX_AGE_MS = 55 * 60 * 1000;
const CONNECT_MS = 15 * 1000;
const encoder = new TextEncoder();

type Item = Record<string, unknown>;
type Payload = Record<string, unknown> & { input: Item[] };
type Previous = { payload: Payload; record: ReplayRecord };
type Connection = {
	socket: WebSocket;
	token: string;
	session?: string;
	createdAt: number;
	busy: boolean;
	previous?: Previous;
	idle?: ReturnType<typeof setTimeout>;
	stop?: () => void;
};

function continuation(payload: Payload, previous?: Previous): Payload {
	if (!previous) return payload;
	const { input, ...settings } = payload;
	const { input: prefix, ...oldSettings } = previous.payload;
	if (!isDeepStrictEqual(settings, oldSettings) || !isDeepStrictEqual(input.slice(0, prefix.length), prefix)) return payload;
	const original = previous.record.output;
	const output = input.slice(prefix.length, prefix.length + original.length);
	if (output.length !== original.length || output.some((item, i) => item.id !== original[i].id)) return payload;
	if (!isDeepStrictEqual(restoreInput(output, [previous.record], previous.record.model), original)) return payload;
	const delta = input.slice(prefix.length + output.length);
	if (!delta.length) return payload;
	return { ...payload, previous_response_id: previous.record.responseId, input: delta };
}

class RetryConnection extends Error {}

/** Adapts Responses WebSocket events to the built-in provider's fetch/SSE boundary. */
export class ResponsesWebSocket {
	private sessions = new Map<string, Connection>();
	private connections = new Set<Connection>();
	private httpSessions = new Set<string>();
	private generation = 0;

	close(): void {
		this.generation++;
		for (const connection of this.connections) {
			connection.stop?.();
			this.discard(connection);
		}
		this.httpSessions.clear();
	}

	fetch(fallback: typeof globalThis.fetch = globalThis.fetch): typeof globalThis.fetch {
		return async (input, init) => {
			const generation = this.generation;
			const request = new Request(input instanceof Request ? input.clone() : input, init);
			const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
			if (request.url !== ENDPOINT || request.method !== "POST" || !token || token.startsWith("sk-")) {
				return fallback(input, init);
			}
			const session = request.headers.get("session_id") ?? request.headers.get("session-id") ?? undefined;
			if (session && this.httpSessions.has(session)) return fallback(input, init);
			const body = await request.json() as Payload;
			if (!Array.isArray(body.input)) return fallback(input, init);
			const { stream: _stream, background: _background, previous_response_id: _previous, ...fields } = body;
			const payload: Payload = { ...fields, input: body.input, store: false };
			const signal = request.signal;
			for (let attempt = 0; ; attempt++) {
				signal.throwIfAborted();
				if (generation !== this.generation) throw new DOMException("Session closed", "AbortError");
				let connection: Connection;
				try {
					connection = await this.acquire(token, session, signal);
				} catch {
					signal.throwIfAborted();
					if (generation !== this.generation) throw new DOMException("Session closed", "AbortError");
					if (session) this.httpSessions.add(session);
					return fallback(input, init);
				}
				if (generation !== this.generation) throw new DOMException("Session closed", "AbortError");
				const outgoing = attempt === 0 ? continuation(payload, connection.previous) : payload;
				connection.previous = undefined;
				try {
					return await this.send(connection, outgoing, payload, signal, attempt === 0);
				} catch (error) {
					this.discard(connection);
					if (!(error instanceof RetryConnection)) throw error;
				}
			}
		};
	}

	private discard(connection: Connection): void {
		clearTimeout(connection.idle);
		connection.previous = undefined;
		this.connections.delete(connection);
		if (connection.session && this.sessions.get(connection.session) === connection) this.sessions.delete(connection.session);
		connection.socket.close();
	}

	private async acquire(token: string, session: string | undefined, signal: AbortSignal): Promise<Connection> {
		const cached = session ? this.sessions.get(session) : undefined;
		if (cached && !cached.busy) {
			if (cached.token === token && cached.socket.readyState === 1 && Date.now() - cached.createdAt < MAX_AGE_MS) {
				clearTimeout(cached.idle);
				cached.busy = true;
				return cached;
			}
			this.discard(cached);
		}
		// A busy session gets a temporary connection so auxiliary calls cannot change its chain.
		const socket = new (globalThis.WebSocket as unknown as new (url: string, options: { headers: Record<string, string> }) => WebSocket)(
			ENDPOINT.replace("https:", "wss:"), { headers: { Authorization: `Bearer ${token}` } },
		);
		const connection: Connection = { socket, token, session: cached?.busy ? undefined : session, createdAt: Date.now(), busy: true };
		this.connections.add(connection);
		if (connection.session) this.sessions.set(connection.session, connection);
		socket.addEventListener("close", () => this.discard(connection), { once: true });
		await new Promise<void>((resolve, reject) => {
			const cleanup = () => {
				clearTimeout(timer);
				socket.removeEventListener("open", opened);
				socket.removeEventListener("error", failed);
				socket.removeEventListener("close", failed);
				signal.removeEventListener("abort", aborted);
				connection.stop = undefined;
			};
			const opened = () => { cleanup(); resolve(); };
			const failed = () => { cleanup(); this.discard(connection); reject(new Error("OpenAI WebSocket connection failed")); };
			const aborted = () => { cleanup(); this.discard(connection); reject(signal.reason); };
			const timer = setTimeout(failed, CONNECT_MS);
			connection.stop = failed;
			socket.addEventListener("open", opened, { once: true });
			socket.addEventListener("error", failed, { once: true });
			socket.addEventListener("close", failed, { once: true });
			signal.addEventListener("abort", aborted, { once: true });
			if (signal.aborted) aborted();
		});
		return connection;
	}

	private send(connection: Connection, outgoing: Payload, payload: Payload, signal: AbortSignal, canRetry: boolean): Promise<Response> {
		return new Promise((resolve, reject) => {
			const socket = connection.socket;
			let started = false;
			let ended = false;
			let controller: ReadableStreamDefaultController<Uint8Array>;
			const output = new ResponseOutput();
			const body = new ReadableStream<Uint8Array>({
				start(value) { controller = value; },
				cancel: () => { cleanup(); this.discard(connection); },
			});
			const cleanup = () => {
				ended = true;
				socket.removeEventListener("message", message);
				socket.removeEventListener("error", disconnected);
				socket.removeEventListener("close", disconnected);
				signal.removeEventListener("abort", aborted);
				connection.stop = undefined;
			};
			const fail = (error: unknown) => {
				if (ended) return;
				cleanup();
				this.discard(connection);
				if (started) {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error: { message: error instanceof Error ? error.message : String(error) } })}\n\n`));
					controller.close();
				} else reject(error);
			};
			const disconnected = () => fail(new Error("OpenAI WebSocket closed before the response completed"));
			const aborted = () => {
				if (ended) return;
				cleanup();
				this.discard(connection);
				if (started) controller.error(signal.reason);
				else reject(signal.reason);
			};
			const message = (event: MessageEvent) => {
				if (ended) return;
				let data: Record<string, any>;
				try {
					data = JSON.parse(String(event.data));
					if (!data || typeof data.type !== "string") throw new Error("Invalid OpenAI WebSocket event");
				} catch (error) { fail(error); return; }
				if (data.type === "error" && !started) {
					const error = data.error ?? data;
					cleanup();
					this.discard(connection);
					const invalidPrevious = outgoing.previous_response_id && (error.code === "previous_response_not_found" ||
						/invalid\s+[`'"]?previous_response_id/i.test(error.message ?? ""));
					if (canRetry && (invalidPrevious || error.code === "websocket_connection_limit_reached")) {
						reject(new RetryConnection());
					} else {
						const status = Number.isInteger(data.status) && data.status >= 400 && data.status <= 599 ? data.status : 500;
						resolve(Response.json({ error }, { status }));
					}
					return;
				}
				if (!started) {
					started = true;
					resolve(new Response(body, { headers: { "Content-Type": "text/event-stream" } }));
				}
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
				output.observe(data);
				if (!["response.completed", "response.incomplete", "response.failed", "error"].includes(data.type)) return;
				cleanup();
				controller.close();
				const response = data.response;
				if (data.type === "response.completed" && typeof response?.id === "string") {
					const items = output.snapshot();
					if (items) {
						const toolArguments: Record<string, unknown> = {};
						for (const item of items) {
							if (item.type !== "function_call" || typeof item.arguments !== "string") continue;
							// Truncated arguments cannot be matched safely to Pi's parsed projection.
							try { toolArguments[item.id] = JSON.parse(item.arguments); } catch { /* Keep full requests for this projection. */ }
						}
						connection.previous = { payload, record: { model: String(payload.model), responseId: response.id, output: items, toolArguments } };
					}
					connection.busy = false;
					if (connection.session) {
						connection.idle = setTimeout(() => this.discard(connection), IDLE_MS);
						connection.idle.unref();
					} else this.discard(connection);
				} else this.discard(connection);
			};
			connection.stop = disconnected;
			socket.addEventListener("message", message);
			socket.addEventListener("error", disconnected);
			socket.addEventListener("close", disconnected);
			signal.addEventListener("abort", aborted, { once: true });
			if (signal.aborted) { aborted(); return; }
			try { socket.send(JSON.stringify({ ...outgoing, type: "response.create" })); }
			catch (error) { fail(error); }
		});
	}
}
