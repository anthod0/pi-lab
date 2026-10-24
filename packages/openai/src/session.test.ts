import assert from "node:assert/strict";
import { mkdirSync, mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Type } from "typebox";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-responses";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import openai from "./index";

function response(id: string, output: any[]): Response {
	const events: any[] = [{ type: "response.created", response: { id } }];
	for (const [output_index, item] of output.entries()) {
		events.push({ type: "response.output_item.added", output_index, item });
		events.push({ type: "response.output_item.done", output_index, item });
	}
	events.push({ type: "response.completed", response: { id, status: "completed", output: [] } });
	return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
		headers: { "Content-Type": "text/event-stream" },
	});
}

function answer(id: string): any {
	return { type: "message", id, role: "assistant", status: "completed", phase: "final_answer", content: [{
		type: "output_text", text: "Answer", annotations: [{ type: "url_citation", url: "https://example.com/", title: "Source", start_index: 0, end_index: 6 }],
	}] };
}

test("real Pi session replays native items, executes local tools, retries and resumes without changing the request prefix", async (t) => {
	const root = mkdtempDisposableSync(join(tmpdir(), "pi-openai-sdk-"));
	let dispose = () => {};
	t.after(() => { dispose(); root.remove(); });
	const home = join(root.path, "home");
	const cwd = join(root.path, "project");
	const agentDir = join(home, ".pi", "agent");
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ openai: { webSearch: true } }));
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"), modelsPath: null, modelsStorePath: join(agentDir, "models-cache.json"),
		allowModelNetwork: false, refreshOnCreate: false,
	});
	t.mock.method(modelRuntime, "isUsingOAuth", () => true);
	t.mock.method(modelRuntime, "hasConfiguredAuth", () => true);
	t.mock.method(modelRuntime, "getAuth", async () => ({ apiKey: "test-only-not-a-credential" }));
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const executions: unknown[] = [];
	const resourceLoader = new DefaultResourceLoader({
		cwd, agentDir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
		agentsFilesOverride: () => ({ agentsFiles: [] }),
		extensionFactories: [
			(pi) => openai(pi, { home }),
			(pi) => pi.registerTool({
				name: "echo", label: "Echo", description: "Echo a test value", parameters: Type.Object({ value: Type.String() }),
				async execute(_id, args) { executions.push(args); return { content: [{ type: "text", text: args.value }], details: undefined }; },
			}),
		],
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd, agentDir, resourceLoader, modelRuntime, settingsManager, noTools: "builtin", thinkingLevel: "off",
		sessionManager: SessionManager.inMemory(cwd),
		model: {
			provider: "openai", api: "openai-responses", id: "test-model", name: "Test", baseUrl: "https://api.openai.com/v1",
			reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 10000, maxTokens: 1000,
		},
	});
	dispose = () => session.dispose();
	const errors: unknown[] = [];
	await session.bindExtensions({ onError: (error) => errors.push(error) });
	const first = [
		{ type: "web_search_call", id: "ws_search", status: "completed", action: { type: "search", query: "news", queries: ["news"] } },
		{ type: "function_call", id: "fc_echo", call_id: "call_echo", name: "echo", arguments: '{ "value": "local result" }', status: "completed" },
	];
	const second = [answer("msg_second")];
	const payloads: any[] = [];
	const transport = async (_url: unknown, init?: RequestInit) => {
		const body = JSON.parse(init!.body as string);
		payloads.push(body);
		if (payloads.length === 1) return new Response(JSON.stringify({ error: { message: "Temporary failure", type: "server_error" } }), {
			status: 503, headers: { "Content-Type": "application/json", "retry-after-ms": "1" },
		});
		if (payloads.length === 2) return response("resp_first", first);
		if (payloads.length === 3) return response("resp_second", second);
		return response(`resp_${payloads.length}`, [answer(`msg_${payloads.length}`)]);
	};
	let lastRequest: any;
	session.agent.streamFunction = ((model: any, context: any, options: any) => {
		lastRequest = { model, context, options };
		return streamSimple(model, context, { ...options, apiKey: "test-only-not-a-credential", fetch: transport, maxRetries: 1 });
	}) as any;
	await session.prompt("Search, then echo the result.");
	assert.deepEqual(errors, []);
	assert.deepEqual(executions, [{ value: "local result" }]);
	assert.equal(payloads.length, 3);
	assert.deepEqual(payloads[0], payloads[1]); // Actual HTTP retry, not a second hook invocation.
	const initial = payloads[1].input;
	assert.deepEqual(payloads[2].input.slice(0, initial.length + first.length), [...initial, ...first]);
	assert.deepEqual(payloads[2].input.at(-1), { type: "function_call_output", call_id: "call_echo", output: "local result" });
	// The cache warmer reuses the last context/options while the agent is idle.
	await streamSimple(lastRequest.model, lastRequest.context, { ...lastRequest.options, apiKey: "test-only-not-a-credential", fetch: transport }).result();
	assert.deepEqual(payloads[3].input, payloads[2].input);
	assert.deepEqual(payloads[3].tools, payloads[2].tools);
	await session.reload();
	await session.prompt("Did you search?");
	assert.deepEqual(errors, []);
	assert.deepEqual(payloads[4].input.slice(0, payloads[2].input.length + second.length), [...payloads[2].input, ...second]);
	// Raw annotations stay in provider replay, not appended as assistant text.
	const stored = session.messages.filter((message) => message.role === "assistant");
	assert.equal(stored.length, 3);
	assert.equal(stored[1].content.filter((part) => part.type === "text").length, 1);
});
