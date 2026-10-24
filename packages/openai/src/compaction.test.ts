import assert from "node:assert/strict";
import { mkdirSync, mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { Type } from "typebox";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-responses";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import openai from "./index";

function text(id: string, value: string): any {
	return { type: "message", id, role: "assistant", status: "completed", content: [{ type: "output_text", text: value, annotations: [] }] };
}

function search(id: string, query: string): any {
	return { type: "web_search_call", id, status: "completed", action: { type: "search", queries: [query] } };
}

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

async function setup(t: TestContext, automatic = false) {
	const root = mkdtempDisposableSync(join(tmpdir(), "pi-openai-compaction-"));
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
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: automatic, keepRecentTokens: 64, reserveTokens: 1000 }, retry: { enabled: false },
	});
	const executions: unknown[] = [];
	const summaryInputs: SessionBeforeCompactEvent["preparation"]["messagesToSummarize"][] = [];
	const resourceLoader = new DefaultResourceLoader({
		cwd, agentDir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
		agentsFilesOverride: () => ({ agentsFiles: [] }),
		extensionFactories: [
			(pi) => openai(pi, { home }),
			(pi) => {
				pi.on("session_before_compact", ({ preparation }) => {
					summaryInputs.push(structuredClone([...preparation.messagesToSummarize, ...preparation.turnPrefixMessages]));
				});
				pi.registerTool({
					name: "echo", label: "Echo", description: "Echo", parameters: Type.Object({ value: Type.String() }),
					async execute(_id, args) { executions.push(args); return { content: [{ type: "text", text: args.value }], details: undefined }; },
				});
			},
		],
	});
	await resourceLoader.reload();
	const manager = SessionManager.inMemory(cwd);
	const { session } = await createAgentSession({
		cwd, agentDir, resourceLoader, modelRuntime, settingsManager, sessionManager: manager, noTools: "builtin", thinkingLevel: "off",
		model: {
			provider: "openai", api: "openai-responses", id: "test-model", name: "Test", baseUrl: "https://api.openai.com/v1",
			reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 20000, maxTokens: 1000,
		},
	});
	dispose = () => session.dispose();
	const errors: unknown[] = [];
	await session.bindExtensions({ onError: (error) => errors.push(error) });
	t.after(() => assert.deepEqual(errors, []));
	const queued: any[][] = [];
	const requests: { summary: boolean; body: any }[] = [];
	const reasons: string[] = [];
	let summarizing = false;
	session.subscribe((event) => {
		if (event.type === "compaction_start") { summarizing = true; reasons.push(event.reason); }
		if (event.type === "compaction_end") summarizing = false;
	});
	session.agent.streamFunction = ((model: any, context: any, options: any) => streamSimple(model, context, {
		...options, apiKey: "test-only-not-a-credential", maxRetries: 0,
		fetch: async (_url: unknown, init?: RequestInit) => {
			requests.push({ summary: summarizing, body: JSON.parse(init!.body as string) });
			const id = `response_${requests.length}`;
			const output = summarizing ? [text(`summary_${id}`, "Checkpoint of completed work.")] : queued.shift();
			assert.ok(output, "Unexpected ordinary model request");
			return response(id, output);
		},
	})) as any;
	return {
		session, manager, requests, reasons, executions, summaryInputs,
		async prompt(prompt: string, ...outputs: any[][]) { queued.push(...outputs); await session.prompt(prompt); },
		keepTail() { manager.appendMessage({ role: "user", content: "Retained context. ".repeat(100), timestamp: 1 }); },
		summaries() {
			return requests.filter((request) => request.summary).map(({ body }) => body.input
				.filter((item: any) => item.role === "user")
				.flatMap((item: any) => item.content.map((part: any) => part.text ?? "")).join("\n") as string);
		},
	};
}

test("manual compaction sends native actions and actual sources in historical order", async (t) => {
	const app = await setup(t);
	const sourced = search("ws_sources", "sourced-query");
	sourced.action.sources = [{ type: "url", url: "https://example.com/returned-source" }];
	await app.prompt("Research, then echo.", [
		text("msg_before", "Before searching."),
		search("ws_query", "native-query"),
		text("msg_between", "Between searches."),
		sourced,
		{ type: "web_search_call", id: "ws_open", status: "completed", action: { type: "open_page", url: "https://example.com/opened-page" } },
		{ type: "web_search_call", id: "ws_find", status: "completed", action: { type: "find_in_page", url: "https://example.com/opened-page", pattern: "needle" } },
		{ type: "function_call", id: "fc_echo", call_id: "call_echo", name: "echo", arguments: '{"value":"local-tool-output"}' },
	], [text("msg_answer", "Research complete.")]);
	app.keepTail();
	await app.session.compact();
	assert.equal(app.summaries().length, 1);
	const input = app.summaries()[0];
	const ordered = ["Before searching.", "native-query", "Between searches.", "sourced-query", "returned-source", "open_page", "find_in_page", "needle", "local-tool-output", "Research complete."];
	let position = -1;
	for (const value of ordered) {
		const next = input.indexOf(value, position + 1);
		assert.ok(next > position, `Missing or out-of-order compaction input: ${value}`);
		position = next;
	}
	const calls = app.summaryInputs[0].flatMap((message) => message.role === "assistant" ? message.content.filter((block) => block.type === "toolCall") : []);
	assert.deepEqual(calls.map((call) => call.name), ["web_search", "web_search", "web_search", "web_search", "echo"]);
	// Only returned sources and the real local echo output have results; no fabricated open/find/search results.
	const results = app.summaryInputs[0].filter((message) => message.role === "toolResult");
	assert.deepEqual(results.map((result) => result.toolName), ["web_search", "echo"]);
	assert.equal(results[0].toolCallId, "ws_sources");
	assert.deepEqual(app.executions, [{ value: "local-tool-output" }]);
});

test("split-turn compaction puts each action only in its own summary request and excludes retained actions", async (t) => {
	const app = await setup(t);
	await app.prompt("Earlier task.", [search("ws_history", "history-query"), text("msg_history", "Earlier task done.")]);
	await app.prompt("Current task.", [
		search("ws_prefix", "prefix-query"),
		{ type: "function_call", id: "fc_split", call_id: "call_split", name: "echo", arguments: '{"value":"prefix-output"}' },
	], [search("ws_kept", "retained-query"), text("msg_kept", "Recent answer. ".repeat(100))]);
	await app.session.compact();
	const inputs = app.summaries();
	assert.equal(inputs.length, 2);
	assert.ok(inputs[0].includes("history-query"));
	assert.ok(!inputs[0].includes("prefix-query"));
	assert.ok(inputs[1].includes("prefix-query"));
	assert.ok(inputs[1].includes("prefix-output"));
	assert.ok(!inputs[1].includes("history-query"));
	assert.ok(inputs.every((input) => !input.includes("retained-query")));
});

for (const excludedBy of ["branch", "replacement", "omission"] as const) {
	test(`compaction excludes native records removed by ${excludedBy}`, async (t) => {
		const app = await setup(t);
		await app.prompt("Shared start.", [text("msg_shared", "Shared answer.")]);
		const forkPoint = app.manager.getLeafId()!;
		await app.prompt("Earlier task.", [search("ws_excluded", "excluded-query"), text("msg_excluded", "Original answer.")]);
		if (excludedBy === "branch") {
			app.manager.branch(forkPoint);
			await app.session.reload();
		} else {
			app.manager.appendContextEdit(app.manager.getLeafId()!, excludedBy === "replacement" ? { content: "Replacement answer." } : null);
		}
		await app.prompt("Active task.", [search("ws_active", "active-query"), text("msg_active", "Active answer.")]);
		app.keepTail();
		await app.session.compact();
		const input = app.summaries()[0];
		assert.ok(input.includes("active-query"));
		assert.ok(!input.includes("excluded-query"));
		assert.ok(!input.includes("Original answer."));
		if (excludedBy === "replacement") assert.ok(input.includes("Replacement answer."));
	});
}

test("compaction does not infer search actions from answers without captured provider data", async (t) => {
	const app = await setup(t);
	await app.prompt("Shared start.", [text("msg_shared", "Shared answer.")]);
	const assistant = app.manager.getEntries().find((entry) => entry.type === "message" && entry.message.role === "assistant");
	assert.ok(assistant?.type === "message" && assistant.message.role === "assistant");
	app.manager.appendMessage({ ...assistant.message, responseId: "uncaptured", content: [{ type: "text", text: "Found https://example.com/uncaptured-source" }] });
	app.keepTail();
	await app.session.compact();
	assert.ok(app.summaries()[0].includes("uncaptured-source"));
	assert.ok(app.summaryInputs[0].every((message) => message.role !== "toolResult" &&
		(message.role !== "assistant" || message.content.every((block) => block.type !== "toolCall"))));
});

test("compaction after reload enriches the summary without modifying stored messages or provider records", async (t) => {
	const app = await setup(t);
	await app.prompt("Search.", [search("ws_saved", "saved-query"), text("msg_saved", "Search done.")]);
	app.keepTail();
	const original = structuredClone(app.manager.getEntries());
	await app.session.reload();
	await app.session.compact();
	assert.ok(app.summaries()[0].includes("saved-query"));
	assert.deepEqual(app.manager.getEntries().slice(0, original.length), original);
	assert.equal(app.manager.getEntries().at(-1)?.type, "compaction");
});

for (const nextRequest of ["ordinary turn", "repeat compaction"]) {
	test(`compacted native records do not reappear in the next ${nextRequest}`, async (t) => {
		const app = await setup(t);
		await app.prompt("Search.", [search("ws_old", "old-query"), text("msg_old", "Search done.")]);
		app.keepTail();
		await app.session.compact();
		assert.ok(app.summaries()[0].includes("old-query"));
		await app.prompt("Continue.", [text("msg_next", "Continued.")]);
		if (nextRequest === "repeat compaction") {
			app.keepTail();
			await app.session.compact();
		}
		assert.ok(!JSON.stringify(app.requests.at(-1)!.body.input).includes("old-query"));
	});
}

test("automatic threshold compaction includes recorded native actions in the actual summary request", async (t) => {
	const app = await setup(t, true);
	await app.prompt("Search first.", [search("ws_auto", "automatic-query"), text("msg_auto", "Search done.")]);
	app.manager.appendMessage({ role: "user", content: "Large retained user message. ".repeat(4000), timestamp: 1 });
	await app.prompt("Continue.", [text("msg_after_auto", "Done.")]);
	assert.ok(app.reasons.includes("threshold"));
	assert.ok(app.summaries().some((input) => input.includes("automatic-query")));
});
