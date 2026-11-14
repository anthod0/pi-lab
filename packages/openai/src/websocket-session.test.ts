import assert from "node:assert/strict";
import { mkdirSync, mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Type } from "typebox";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import openai from "./index";

test("Pi provider registration preserves hooks, retries, tool execution, replay, usage and reload over WebSocket", async (t) => {
	const root = mkdtempDisposableSync(join(tmpdir(), "pi-openai-websocket-"));
	let dispose = () => {};
	const nativeSocket = globalThis.WebSocket;
	t.after(() => { dispose(); globalThis.WebSocket = nativeSocket; root.remove(); });
	const agentDir = join(root.path, "agent");
	const cwd = join(root.path, "project");
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	mkdirSync(agentDir, { recursive: true });
	const configPath = join(cwd, ".pi", "settings.json");
	writeFileSync(configPath, JSON.stringify({ openai: { optimizeLatency: true, fast: true, webSearch: true } }));
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"), modelsPath: null, modelsStorePath: join(agentDir, "models-cache.json"),
		allowModelNetwork: false, refreshOnCreate: false,
	});
	t.mock.method(modelRuntime, "isUsingOAuth", () => true);
	t.mock.method(modelRuntime, "hasConfiguredAuth", () => true);
	t.mock.method(modelRuntime, "getAuth", async () => ({ auth: { apiKey: "test-siwc-token" } }));
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const executions: unknown[] = [];
	const fullPayloads: any[] = [];
	const observedResponses: any[] = [];
	const resourceLoader = new DefaultResourceLoader({
		cwd, agentDir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
		agentsFilesOverride: () => ({ agentsFiles: [] }),
		extensionFactories: [
			(pi) => openai(pi, { agentDir }),
			(pi) => {
				pi.on("before_provider_request", (event) => { fullPayloads.push(structuredClone(event.payload)); });
				pi.on("after_provider_response", (event) => { observedResponses.push(event); });
				pi.registerTool({
					name: "echo", label: "Echo", description: "Echo a test value", parameters: Type.Object({ value: Type.String() }),
					async execute(_id, args) { executions.push(args); return { content: [{ type: "text", text: args.value }], details: undefined }; },
				});
			},
		],
	});
	await resourceLoader.reload();
	const model = {
		provider: "openai", api: "openai-responses", id: "test-model", name: "Test", baseUrl: "https://api.openai.com/v1",
		reasoning: false, input: ["text" as const], cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 }, contextWindow: 10000, maxTokens: 1000,
	};
	const { session } = await createAgentSession({
		cwd, agentDir, resourceLoader, modelRuntime, settingsManager, noTools: "builtin", thinkingLevel: "off",
		sessionManager: SessionManager.inMemory(cwd), model,
	});
	dispose = () => session.dispose();
	const errors: unknown[] = [];
	await session.bindExtensions({ onError: (error) => errors.push(error) });
	const first = [
		{ type: "web_search_call", id: "ws_search", status: "completed", action: { type: "search", query: "news", sources: [{ type: "url", url: "https://example.com" }] } },
		{ type: "function_call", id: "fc_echo", call_id: "call_echo", name: "echo", arguments: '{ "value": "local result" }', status: "completed" },
	];
	const answer = (id: string) => ({ type: "message", id, role: "assistant", status: "completed", content: [{ type: "output_text", text: "Answer", annotations: [] }] });
	const sockets: Socket[] = [];
	const requests: any[] = [];
	class Socket extends EventTarget {
		readyState = 0;
		constructor() { super(); sockets.push(this); queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); }); }
		close() { if (this.readyState === 3) return; this.readyState = 3; this.dispatchEvent(new Event("close")); }
		event(data: any) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) })); }
		send(value: string) {
			requests.push(JSON.parse(value));
			const n = requests.length;
			if (n === 1) { this.event({ type: "error", status: 503, error: { message: "Temporary failure", type: "server_error" } }); return; }
			const output = n === 2 ? first : [answer(`msg_${n}`)];
			this.event({ type: "response.created", response: { id: `resp_${n}` } });
			output.forEach((item, output_index) => {
				this.event({ type: "response.output_item.added", output_index, item });
				this.event({ type: "response.output_item.done", output_index, item });
			});
			this.event({ type: "response.completed", response: {
				id: `resp_${n}`, status: "completed", output, service_tier: "priority",
				usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110, input_tokens_details: { cached_tokens: 80 } },
			} });
		}
	}
	globalThis.WebSocket = Socket as any;
	const fallback = t.mock.fn(async () => new Response("Unexpected HTTP", { status: 500 }));
	let lastRequest: any;
	session.agent.streamFunction = ((model: any, context: any, options: any) => {
		lastRequest = { model, context, options };
		return modelRuntime.streamSimple(model, context, { ...options, fetch: fallback, maxRetries: 1 });
	}) as any;
	await session.prompt("Search, then echo.");
	assert.deepEqual(errors, []);
	assert.deepEqual(executions, [{ value: "local result" }], JSON.stringify(session.messages));
	assert.equal(requests.length, 3);
	assert.deepEqual(requests[0], requests[1]);
	assert.equal(requests[2].previous_response_id, "resp_2");
	assert.deepEqual(requests[2].input, [{ type: "function_call_output", call_id: "call_echo", output: "local result" }]);
	assert.deepEqual(fullPayloads[1].input.slice(0, requests[1].input.length + first.length), [...requests[1].input, ...first]);
	assert.equal(observedResponses.length, 2);
	const assistant = session.messages.filter((message) => message.role === "assistant").at(-1)!;
	assert.equal(assistant.responseId, "resp_3");
	assert.equal(assistant.usage.input, 20);
	assert.equal(assistant.usage.cacheRead, 80);
	assert.equal(assistant.usage.output, 10);
	assert.ok(assistant.usage.cost.total > 0);
	await session.prompt("Continue.");
	assert.equal(requests[3].previous_response_id, "resp_3");
	assert.equal(requests[3].input.length, 1);
	await modelRuntime.streamSimple(lastRequest.model, lastRequest.context, { ...lastRequest.options, fetch: fallback }).result();
	assert.equal(requests[4].previous_response_id, undefined); // Warming repeats the previous input.
	await session.reload();
	await session.prompt("After reload.");
	assert.equal(requests[5].previous_response_id, undefined);
	assert.ok(requests[5].input.some((item: any) => item.id === "ws_search"));
	assert.equal(sockets.length, 3);
	await session.prompt("/fast off");
	await session.prompt("Standard processing.");
	assert.equal(requests[6].service_tier, undefined);
	assert.equal(requests[6].previous_response_id, undefined);
	for (const request of requests) {
		assert.equal(request.stream, undefined);
		assert.equal(request.store, false);
		assert.ok(request.tools.some((tool: any) => tool.type === "web_search"));
		assert.ok(request.include.includes("web_search_call.action.sources"));
		assert.ok(request.prompt_cache_key);
	}
	assert.equal(fallback.mock.callCount(), 0);
	writeFileSync(configPath, JSON.stringify({ openai: { optimizeLatency: false } }));
	await session.reload();
	assert.equal(sockets.at(-1)!.readyState, 3);
	const disabled = await modelRuntime.streamSimple(model, { messages: [{ role: "user", content: "HTTP", timestamp: 1 }] }, { fetch: fallback, maxRetries: 0 }).result();
	assert.equal(fallback.mock.callCount(), 1, JSON.stringify(disabled));
	assert.deepEqual(errors, []);
});
