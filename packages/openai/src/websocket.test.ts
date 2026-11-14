import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { ResponsesWebSocket } from "./websocket";

const endpoint = "https://api.openai.com/v1/responses";
const user = { role: "user", content: "Hello" };
const output = { type: "message", id: "msg_first", role: "assistant", content: [{ type: "output_text", text: "Hi" }] };
const next = { role: "user", content: "Continue" };
const payload = { model: "test-model", store: false, stream: true, background: false, input: [user], tools: [], reasoning: { effort: "low" } };

function setup(t: TestContext) {
	const sockets: Socket[] = [];
	let onSend = (socket: Socket, _body: any) => socket.complete();
	let handshake: "open" | "error" | "pending" = "open";
	class Socket extends EventTarget {
		readyState = 0;
		requests: any[] = [];
		constructor(readonly url: string, readonly options: { headers: Record<string, string> }) {
			super();
			sockets.push(this);
			queueMicrotask(() => {
				if (handshake === "pending" || this.readyState !== 0) return;
				this.readyState = handshake === "open" ? 1 : 3;
				this.dispatchEvent(new Event(handshake));
			});
		}
		send(data: string) { const body = JSON.parse(data); this.requests.push(body); onSend(this, body); }
		close() {
			if (this.readyState === 3) return;
			this.readyState = 3;
			this.dispatchEvent(new Event("close"));
		}
		event(data: unknown) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) })); }
		complete(id = "resp_first", items: any[] = [output]) {
			this.event({ type: "response.created", response: { id } });
			this.event({ type: "response.completed", response: { id, output: items } });
		}
	}
	const original = globalThis.WebSocket;
	globalThis.WebSocket = Socket as any;
	t.after(() => { globalThis.WebSocket = original; });
	const transport = new ResponsesWebSocket();
	t.after(() => transport.close());
	const http: Array<{ input: any; init: any }> = [];
	const fetch = transport.fetch(async (input, init) => { http.push({ input, init }); return new Response("HTTP"); });
	return {
		sockets, transport, http, fetch,
		set onSend(value: typeof onSend) { onSend = value; },
		set handshake(value: typeof handshake) { handshake = value; },
		request(body: any = payload, options: { session?: string | null; token?: string; signal?: AbortSignal; url?: string } = {}) {
			return fetch(options.url ?? endpoint, {
				method: "POST", body: JSON.stringify(body), signal: options.signal,
				headers: { Authorization: `Bearer ${options.token ?? "siwc-test"}`, ...(options.session === null ? {} : { session_id: options.session ?? "session" }) },
			});
		},
	};
}

test("first request is full; subsequent requests send only new input on the authenticated connection", async (t) => {
	const app = setup(t);
	await (await app.request()).text();
	await (await app.request({ ...payload, input: [user, output, next] })).text();
	assert.equal(app.sockets.length, 1);
	assert.equal(app.sockets[0].url, "wss://api.openai.com/v1/responses");
	assert.deepEqual(app.sockets[0].options.headers, { Authorization: "Bearer siwc-test" });
	assert.deepEqual(app.sockets[0].requests, [
		{ model: "test-model", store: false, input: [user], tools: [], reasoning: { effort: "low" }, type: "response.create" },
		{ model: "test-model", store: false, input: [next], tools: [], reasoning: { effort: "low" }, type: "response.create", previous_response_id: "resp_first" },
	]);
});

for (const [name, changed] of Object.entries({
	model: { model: "other" }, fast: { service_tier: "priority" }, tools: { tools: [{ type: "web_search" }] },
	reasoning: { reasoning: { effort: "high" } }, instructions: { instructions: "Different" },
	compaction: { input: [next] }, edit: { input: [{ ...user, content: "Edited" }, output, next] },
	missingOutput: { input: [user, next] }, editedOutput: { input: [user, { ...output, content: [{ type: "output_text", text: "Edited" }] }, next] },
	wrongOutput: { input: [user, { ...output, id: "other" }, next] },
	warmup: { input: [user] }, noNewInput: { input: [user, output] },
})) {
	test(`${name} starts a new full context chain`, async (t) => {
		const app = setup(t);
		await (await app.request()).text();
		const updated = { ...payload, input: [user, output, next], ...changed };
		await (await app.request(updated)).text();
		assert.equal(app.sockets[0].requests[1].previous_response_id, undefined);
		assert.deepEqual(app.sockets[0].requests[1].input, updated.input);
	});
}

test("output item order must match, including tools and reasoning", async (t) => {
	const app = setup(t);
	const items = [{ type: "reasoning", id: "rs_1" }, { type: "function_call", id: "fc_1" }];
	app.onSend = (socket) => socket.complete("resp_tool", items);
	await (await app.request()).text();
	await (await app.request({ ...payload, input: [user, ...[...items].reverse(), next] })).text();
	assert.equal(app.sockets[0].requests[1].previous_response_id, undefined);
	await (await app.request({ ...payload, input: [user, ...[...items].reverse(), next, ...items, next] })).text();
	assert.deepEqual(app.sockets[0].requests[2].input, [next]);
});

test("terminal snapshots and streamed item IDs both enable continuation", async (t) => {
	const app = setup(t);
	app.onSend = (socket) => {
		socket.event({ type: "response.output_item.done", output_index: 0, item: output });
		socket.event({ type: "response.completed", response: { id: "resp_streamed", output: [] } });
	};
	const events = await (await app.request()).text();
	assert.match(events, /data: \{"type":"response.output_item.done"/);
	await (await app.request({ ...payload, input: [user, output, next] })).text();
	assert.equal(app.sockets[0].requests[1].previous_response_id, "resp_streamed");
});

for (const error of [
	{ message: "Invalid `previous_response_id`.", type: "invalid_request_error" },
	{ code: "previous_response_not_found", message: "Missing response" },
	{ code: "websocket_connection_limit_reached", message: "Connection expired" },
]) {
	test(`reconnects once with full input for ${error.code ?? "SIWC invalid ID"}`, async (t) => {
		const app = setup(t);
		await (await app.request()).text();
		let failures = 0;
		app.onSend = (socket) => {
			if (failures++ === 0) socket.event({ type: "error", status: 400, error });
			else socket.complete();
		};
		await (await app.request({ ...payload, input: [user, output, next] })).text();
		assert.equal(app.sockets.length, 2);
		assert.equal(app.sockets[0].readyState, 3);
		assert.equal(app.sockets[1].requests[0].previous_response_id, undefined);
		assert.deepEqual(app.sockets[1].requests[0].input, [user, output, next]);
		app.onSend = (socket) => socket.event({ type: "error", status: 400, error });
		const result = await app.request({ ...payload, input: [user, output, next, output, next] });
		assert.equal(result.status, 400);
		assert.equal(app.sockets.length, 3);
	});
}

for (const status of [400, 429, 503]) {
	test(`pre-stream ${status} errors preserve the HTTP status and provider error body`, async (t) => {
		const app = setup(t);
		const error = { code: "subscription_sharing_usage_limit_exceeded", message: "Limit reached", type: "usage_limit" };
		app.onSend = (socket) => socket.event({ type: "error", status, error });
		const result = await app.request();
		assert.equal(result.status, status);
		assert.deepEqual(await result.json(), { error });
		assert.equal(app.sockets[0].readyState, 3);
	});
}

test("errors after the first event are streamed without replaying the request", async (t) => {
	const app = setup(t);
	app.onSend = (socket) => {
		socket.event({ type: "response.created", response: { id: "resp_failed" } });
		socket.event({ type: "error", status: 400, error: { code: "websocket_connection_limit_reached", message: "Expired" } });
	};
	const result = await app.request();
	assert.equal(result.status, 200);
	assert.match(await result.text(), /"type":"error"/);
	assert.equal(app.sockets.length, 1);
	assert.equal(app.sockets[0].readyState, 3);
});

test("a failed handshake pins only that session to HTTP until reset", async (t) => {
	const app = setup(t);
	app.handshake = "error";
	assert.equal(await (await app.request()).text(), "HTTP");
	app.handshake = "open";
	assert.equal(await (await app.request()).text(), "HTTP");
	await (await app.request(payload, { session: "new" })).text();
	assert.equal(app.sockets.length, 2);
	app.transport.close();
	await (await app.request()).text();
	assert.equal(app.sockets.length, 3);
	assert.equal(app.http.length, 2);
});

test("API keys, custom endpoints and other methods use the original fetch", async (t) => {
	const app = setup(t);
	await app.request(payload, { token: "sk-key" });
	await app.request(payload, { url: "https://proxy.example/v1/responses" });
	await app.fetch(endpoint, { method: "GET" });
	assert.equal(app.http.length, 3);
	assert.equal(app.sockets.length, 0);
});

test("a refreshed token and an idle server close each require a new full request", async (t) => {
	const app = setup(t);
	await (await app.request()).text();
	await (await app.request({ ...payload, input: [user, output, next] }, { token: "refreshed" })).text();
	assert.equal(app.sockets[0].readyState, 3);
	assert.equal(app.sockets[1].requests[0].previous_response_id, undefined);
	app.sockets[1].close();
	await (await app.request()).text();
	assert.equal(app.sockets.length, 3);
});

test("requests without a session and overlapping calls use disposable connections", async (t) => {
	const app = setup(t);
	app.onSend = () => {};
	const first = app.request();
	await new Promise(setImmediate);
	app.onSend = (socket) => socket.complete("resp_aux");
	await (await app.request()).text();
	await (await app.request(payload, { session: null })).text();
	assert.equal(app.sockets[1].readyState, 3);
	assert.equal(app.sockets[2].readyState, 3);
	app.sockets[0].complete("resp_main");
	await (await first).text();
	await (await app.request({ ...payload, input: [user, output, next] })).text();
	assert.equal(app.sockets.length, 3);
	assert.equal(app.sockets[0].requests[1].previous_response_id, "resp_main");
});

for (const phase of ["connect", "before-event", "stream"] as const) {
	test(`aborting during ${phase} closes the connection without falling back to HTTP`, async (t) => {
		const app = setup(t);
		const controller = new AbortController();
		if (phase === "connect") app.handshake = "pending";
		app.onSend = (socket) => { if (phase === "stream") socket.event({ type: "response.created", response: { id: "aborted" } }); };
		const result = app.request(payload, { signal: controller.signal }).then((response) => response.text());
		const rejected = assert.rejects(result);
		await new Promise(setImmediate);
		controller.abort();
		await rejected;
		assert.equal(app.sockets[0].readyState, 3);
		assert.equal(app.http.length, 0);
	});
}

test("cancelling the SSE reader invalidates the continuation", async (t) => {
	const app = setup(t);
	app.onSend = (socket) => socket.event({ type: "response.created", response: { id: "cancelled" } });
	const response = await app.request();
	await response.body!.cancel();
	assert.equal(app.sockets[0].readyState, 3);
});

test("idle expiry closes a connection after five minutes", async (t) => {
	const app = setup(t);
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	await (await app.request()).text();
	t.mock.timers.tick(5 * 60 * 1000);
	assert.equal(app.sockets[0].readyState, 3);
	await (await app.request()).text();
	assert.equal(app.sockets.length, 2);
});

test("connections older than 55 minutes are replaced even when recently active", async (t) => {
	const app = setup(t);
	t.mock.timers.enable({ apis: ["Date"] });
	await (await app.request()).text();
	t.mock.timers.setTime(Date.now() + 55 * 60 * 1000);
	await (await app.request()).text();
	assert.equal(app.sockets[0].readyState, 3);
	assert.equal(app.sockets.length, 2);
});

test("handshake timeout uses HTTP after 15 seconds", async (t) => {
	const app = setup(t);
	t.mock.timers.enable({ apis: ["setTimeout"] });
	app.handshake = "pending";
	const result = app.request();
	await new Promise(setImmediate);
	t.mock.timers.tick(15 * 1000);
	assert.equal(await (await result).text(), "HTTP");
	assert.equal(app.sockets[0].readyState, 3);
});


test("shutdown during connection setup rejects without sending an HTTP request", async (t) => {
	const app = setup(t);
	app.handshake = "pending";
	const result = app.request();
	const rejected = assert.rejects(result, { name: "AbortError" });
	await new Promise(setImmediate);
	app.transport.close();
	await rejected;
	assert.equal(app.http.length, 0);
});

test("HTTP fallback preserves a Request object's body", async (t) => {
	const app = setup(t);
	app.handshake = "error";
	const request = new Request(endpoint, { method: "POST", headers: { Authorization: "Bearer siwc" }, body: JSON.stringify(payload) });
	await app.fetch(request);
	assert.deepEqual(await app.http[0].input.json(), payload);
});
