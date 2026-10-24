import assert from "node:assert/strict";
import { mkdirSync, mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { convertResponsesMessages, processResponsesStream } from "@earendil-works/pi-ai/api/openai-responses-shared";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";

import openai from "./index";

const model: any = {
	id: "test-model", provider: "openai", api: "openai-responses", baseUrl: "https://api.openai.com/v1",
	input: ["text"], reasoning: true, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const user = (text: string): any => ({ role: "user", content: text, timestamp: 1 });
const project = (messages: any[], target = model): any[] => convertResponsesMessages(target, normalizeContext({ messages }), new Set(["openai"]), {
	grammarToolInputProperties: new Map([["shell", "input"]]),
});

function items(suffix = "1"): any[] {
	return [
		{ type: "reasoning", id: `rs_${suffix}`, summary: [{ type: "summary_text", text: "Research" }], encrypted_content: "opaque" },
		{ type: "web_search_call", id: `ws_${suffix}`, status: "completed", action: { type: "search", queries: ["AI news"], query: "AI news" } },
		{ type: "web_search_call", id: `ws_open_${suffix}`, status: "completed", action: { type: "open_page", url: "https://example.com/news" } },
		{ type: "message", id: `msg_${suffix}`, role: "assistant", status: "completed", phase: "final_answer", content: [{
			type: "output_text", text: "News. citeturn0search0", logprobs: [], annotations: [{
				type: "url_citation", url: "https://example.com/news", title: "News", start_index: 6, end_index: 25,
			}],
		}] },
	];
}

function setup(t: TestContext) {
	const directory = mkdtempDisposableSync(join(tmpdir(), "pi-openai-replay-"));
	t.after(() => directory.remove());
	const cwd = join(directory.path, "project");
	const home = join(directory.path, "home");
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	const configPath = join(cwd, ".pi", "settings.json");
	const configure = (enabled: boolean) => writeFileSync(configPath, JSON.stringify({ openai: { webSearch: enabled } }));
	configure(true);
	const handlers = new Map<string, (event: any, ctx: any) => any>();
	let branch: any[] = [];
	const ctx = {
		cwd, hasUI: false, model: { ...model }, modelRegistry: { isUsingOAuth: () => true },
		sessionManager: { getBranch: () => branch },
	};
	openai({
		on(name: string, handler: any) { handlers.set(name, handler); }, registerCommand() {},
		appendEntry(customType: string, data: unknown) { branch.push({ type: "custom", customType, data }); },
	} as any, { home });
	const emit = async (type: string, event: any = {}) => handlers.get(type)?.({ type, ...event }, ctx);
	const raw = (data: any, metadata: any = {}) => emit("provider_stream_event", { provider: "openai", api: "openai-responses", model: "test-model", data, ...metadata });
	const payload = async (input: any[]) => {
		const payload = { model: ctx.model.id, input, store: false };
		return (await emit("before_provider_request", { payload })) ?? payload;
	};
	const start = async () => { await emit("session_start"); await emit("turn_start"); };
	const begin = async (id: string) => {
		await payload([]);
		await raw({ type: "response.created", response: { id } });
	};
	const end = async (message: any) => {
		const original = structuredClone(message);
		const replacement = await emit("message_end", { message });
		assert.equal(replacement, undefined);
		assert.deepEqual(message, original);
		branch.push({ type: "message", message });
	};
	const consume = async (output: any[], options: { id?: string; snapshot?: any[]; terminalHookOnly?: boolean; input?: any[]; incomplete?: boolean } = {}) => {
		const id = options.id ?? "resp-1";
		await payload(options.input ?? []);
		const events: any[] = [{ type: "response.created", response: { id } }];
		for (const [output_index, item] of output.entries()) {
			events.push({ type: "response.output_item.added", output_index, item });
			events.push({ type: "response.output_item.done", output_index, item });
		}
		events.push({ type: options.incomplete ? "response.incomplete" : "response.completed", response: {
			id, status: options.incomplete ? "incomplete" : "completed", output: options.snapshot ?? [],
			...(options.incomplete ? { incomplete_details: { reason: "max_output_tokens" } } : {}),
		} });
		const message: any = {
			role: "assistant", content: [], provider: "openai", api: "openai-responses", model: model.id,
			timestamp: 1, stopReason: "pending",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		};
		await processResponsesStream((async function* () { yield* events; })(), message, { push() {} } as any, model, {
			onProviderStreamEvent: async (event: any) => {
				if (!options.terminalHookOnly || !event.type.startsWith("response.output_item.")) await raw(event);
			},
		});
		await end(message);
		return message;
	};
	return { ctx, emit, raw, payload, start, begin, end, consume, configure,
		get branch() { return branch; }, setBranch(value: any[]) { branch = value; },
	};
}

test("empty terminal output preserves exact native history through the real Pi converter", async (t) => {
	const app = setup(t);
	await app.start();
	const output = items();
	const message = await app.consume(output);
	const messages = [user("Search"), message, user("Did you search?")];
	const input = project(messages);
	const original = structuredClone(input);
	const result = await app.payload(input);
	assert.deepEqual(result.input, [...project([messages[0]]), ...output, ...project([messages[2]])]);
	assert.deepEqual(input, original);
	assert.deepEqual((await app.payload(result.input)).input, result.input); // Idempotent retries.
});

test("JSON session reload restores records on the active branch only", async (t) => {
	const app = setup(t);
	await app.start();
	const output = items();
	const message = await app.consume(output);
	const branch = JSON.parse(JSON.stringify(app.branch));
	const resumed = setup(t);
	resumed.setBranch(branch);
	await resumed.start();
	assert.deepEqual((await resumed.payload(project([message]))).input, output);
	resumed.setBranch([]);
	await resumed.emit("session_tree");
	const input = project([message]);
	assert.deepEqual((await resumed.payload(input)).input, input);
	resumed.setBranch(branch);
	await resumed.emit("session_tree");
	assert.deepEqual((await resumed.payload(input)).input, output);
});

test("compaction and partial or edited responses never resurrect removed history", async (t) => {
	const app = setup(t);
	await app.start();
	const message = await app.consume(items());
	const edited = structuredClone(message);
	edited.content.find((part: any) => part.type === "text").text = "Redacted";
	const inputs = [project([user("Compacted summary")]), project([edited]), project([message]).slice(1)];
	for (const input of inputs) assert.deepEqual((await app.payload(input)).input, input);
});

test("switching model leaves Pi's foreign-model conversion intact", async (t) => {
	const app = setup(t);
	await app.start();
	const message = await app.consume(items());
	app.ctx.model.id = "another-model";
	const input = project([message], app.ctx.model);
	assert.deepEqual((await app.payload(input)).input, input);
});

test("turning search off does not remove previously recorded history", async (t) => {
	const app = setup(t);
	await app.start();
	const output = items();
	const message = await app.consume(output);
	app.configure(false);
	await app.start();
	const result = await app.payload(project([message]));
	assert.deepEqual(result.input, output);
	assert.equal(result.tools, undefined);
});

test("native output is restored around local function calls without changing their results", async (t) => {
	const app = setup(t);
	await app.start();
	const output = [...items().slice(0, 3),
		{ type: "function_call", id: "fc_read", call_id: "call_read", name: "read", arguments: '{ "path": "file" }', status: "completed" },
		{ type: "custom_tool_call", id: "ctc_shell", call_id: "call_shell", name: "shell", input: "pwd", status: "completed" },
	];
	const message = await app.consume(output);
	const results = [
		{ role: "toolResult", toolCallId: "call_read|fc_read", toolName: "read", content: [{ type: "text", text: "file contents" }], isError: false, timestamp: 2 },
		{ role: "toolResult", toolCallId: "call_shell|ctc_shell", toolName: "shell", content: [{ type: "text", text: "/project" }], isError: false, timestamp: 2 },
	];
	const input = project([message, ...results]);
	assert.deepEqual((await app.payload(input)).input, [...output, ...project(results)]);
	const edited = structuredClone(input);
	const call = edited.find((item) => item.type === "function_call");
	call.arguments = '{"path":"different"}';
	assert.deepEqual((await app.payload(edited)).input, edited);
});

test("terminal snapshots recover items missed by the extension hook", async (t) => {
	const app = setup(t);
	await app.start();
	const output = items();
	const message = await app.consume(output, { snapshot: output, terminalHookOnly: true });
	assert.deepEqual((await app.payload(project([message]))).input, output);
});

test("authoritative terminal items preserve reasoning encryption backfilled by the provider", async (t) => {
	const app = setup(t);
	await app.start();
	const final = items();
	const streamed = structuredClone(final);
	delete streamed[0].encrypted_content;
	const message = await app.consume(streamed, { snapshot: final });
	assert.deepEqual((await app.payload(project([message]))).input, final);
});

test("multiple turns retain their own exact output ordering", async (t) => {
	const app = setup(t);
	await app.start();
	const first = items("first");
	const second = items("second");
	const m1 = await app.consume(first, { id: "resp-first" });
	await app.emit("turn_end");
	await app.emit("turn_start");
	const m2 = await app.consume(second, { id: "resp-second" });
	const middle = user("More news");
	assert.deepEqual((await app.payload(project([m1, middle, m2]))).input, [...first, ...project([middle]), ...second]);
});

test("known item IDs isolate a main stream from overlapping cache warming", async (t) => {
	const app = setup(t);
	await app.start();
	const output = items();
	const message = await app.consume(output); // Obtain Pi's normal projection; discard captured branch.
	app.setBranch([]);
	await app.begin("resp-1");
	for (const [output_index, item] of output.entries()) await app.raw({ type: "response.output_item.added", output_index, item });
	await app.begin("warm");
	for (const [output_index, item] of output.entries()) await app.raw({ type: "response.output_item.done", output_index, item });
	await app.raw({ type: "response.completed", response: { id: "warm", output: items("warm") } });
	await app.raw({ type: "response.completed", response: { id: "resp-1", output: [] } });
	await app.end(message);
	assert.deepEqual((await app.payload(project([message]))).input, output);
});

for (const fullSnapshot of [false, true]) {
	test(`ambiguous overlapping items require a full terminal snapshot: ${fullSnapshot}`, async (t) => {
		const app = setup(t);
		await app.start();
		const output = items();
		const message = await app.consume(output);
		app.setBranch([]);
		await app.begin("resp-1");
		await app.begin("warm");
		for (const [output_index, item] of items("warm").entries()) await app.raw({ type: "response.output_item.done", output_index, item });
		await app.raw({ type: "response.completed", response: { id: "resp-1", output: fullSnapshot ? output : [] } });
		await app.end(message);
		const input = project([message]);
		assert.deepEqual((await app.payload(input)).input, fullSnapshot ? output : input);
	});
}

for (const reason of ["error", "aborted"]) {
	test(`does not persist or replay ${reason} responses`, async (t) => {
		const app = setup(t);
		await app.start();
		const message = await app.consume(items());
		app.setBranch([]);
		await app.begin("resp-1");
		await app.raw({ type: "response.completed", response: { id: "resp-1", output: items() } });
		await app.end({ ...message, stopReason: reason });
		assert.equal(app.branch.filter((entry) => entry.type === "custom").length, 0);
		assert.deepEqual((await app.payload(project([message]))).input, project([message]));
	});
}

test("unfinished output does not persist a guessed response", async (t) => {
	const app = setup(t);
	await app.start();
	const message = await app.consume(items());
	app.setBranch([]);
	await app.begin("resp-1");
	await app.raw({ type: "response.output_item.added", output_index: 0, item: items()[0] });
	await app.raw({ type: "response.completed", response: { id: "resp-1", output: [] } });
	await app.end(message);
	assert.deepEqual((await app.payload(project([message]))).input, project([message]));
});

test("unrelated provider events and response IDs cannot persist history", async (t) => {
	const app = setup(t);
	await app.start();
	const message = await app.consume(items());
	app.setBranch([]);
	await app.begin("resp-1");
	await app.raw({ type: "response.completed", response: { id: "resp-1", output: items() } }, { provider: "other" });
	await app.raw({ type: "response.completed", response: { id: "other", output: items() } });
	await app.end(message);
	assert.deepEqual((await app.payload(project([message]))).input, project([message]));
});

test("idle warming replays the same historical input without persisting warm outputs", async (t) => {
	const app = setup(t);
	await app.start();
	const message = await app.consume(items());
	const input = project([message, user("Next")]);
	const active = await app.payload(input);
	await app.emit("turn_end");
	assert.deepEqual(await app.payload(input), active);
	const entries = app.branch.length;
	await app.raw({ type: "response.created", response: { id: "warm" } });
	await app.raw({ type: "response.completed", response: { id: "warm", output: items("warm") } });
	await app.emit("message_end", { message: { ...message, responseId: "warm" } });
	assert.equal(app.branch.length, entries);
});

test("an idle stream crossing turn_start cannot contaminate the main response", async (t) => {
	const app = setup(t);
	await app.start();
	const message = await app.consume(items());
	app.setBranch([]);
	await app.emit("turn_end");
	await app.begin("warm");
	await app.emit("turn_start");
	await app.begin("resp-1");
	const output = items();
	await app.raw({ type: "response.output_item.done", response_id: "resp-1", output_index: 0, item: output[0] });
	await app.raw({ type: "response.output_item.done", response_id: "resp-1", output_index: 1, item: output[1] });
	// No response_id: this could be either stream and must not overwrite index 1.
	await app.raw({ type: "response.output_item.done", output_index: 1, item: items("warm")[1] });
	for (const index of [2, 3]) await app.raw({ type: "response.output_item.done", response_id: "resp-1", output_index: index, item: output[index] });
	await app.raw({ type: "response.completed", response: { id: "resp-1", output: [] } });
	await app.end(message);
	const input = project([message]);
	assert.deepEqual((await app.payload(input)).input, input);
});

for (const snapshot of [false, true]) {
	test(`conflicting output indexes require an authoritative snapshot: ${snapshot}`, async (t) => {
		const app = setup(t);
		await app.start();
		const output = items();
		const message = await app.consume(output);
		app.setBranch([]);
		await app.begin("resp-1");
		for (const [output_index, item] of output.entries()) await app.raw({ type: "response.output_item.done", output_index, item });
		await app.raw({ type: "response.output_item.done", output_index: 1, item: items("conflict")[1] });
		await app.raw({ type: "response.completed", response: { id: "resp-1", output: snapshot ? output : [] } });
		await app.end(message);
		const input = project([message]);
		assert.deepEqual((await app.payload(input)).input, snapshot ? output : input);
	});
}

test("output with no surviving Pi items is retained but never inserted at a guessed position", async (t) => {
	const app = setup(t);
	await app.start();
	const initial = user("Search");
	const output = [items()[1]];
	const message = await app.consume(output, { input: project([initial]), incomplete: true });
	assert.equal(message.stopReason, "length");
	assert.deepEqual(message.content, []);
	assert.deepEqual(app.branch.find((entry) => entry.type === "custom").data.output, output);
	await app.emit("context", { messages: [initial, message, user("Continue")] });
	// A later context handler can remove the empty assistant without changing input.
	const input = project([initial, user("Continue")]);
	assert.deepEqual((await app.payload(input)).input, input);
});

test("token-limited function arguments retain the exact native output without undoing edits", async (t) => {
	const app = setup(t);
	await app.start();
	const output = [items()[1], {
		type: "function_call", id: "fc_partial", call_id: "call_partial", name: "read", arguments: '{"path":"fi', status: "incomplete",
	}];
	const message = await app.consume(output, { incomplete: true });
	assert.equal(message.stopReason, "length");
	const input = project([message]);
	assert.deepEqual((await app.payload(input)).input, [...output, ...input.slice(1)]);
	const edited = structuredClone(input);
	edited[0].arguments = '{"path":"other"}';
	assert.deepEqual((await app.payload(edited)).input, edited);
});

test("an abandoned background stream cannot disable capture in later agent runs", async (t) => {
	const app = setup(t);
	await app.start();
	await app.emit("turn_end");
	await app.begin("cancelled-warm");
	// Local cancellation may not produce any provider terminal event.
	await app.emit("agent_settled");
	await app.emit("turn_start");
	const output = items();
	const message = await app.consume(output);
	assert.deepEqual((await app.payload(project([message]))).input, output);
});

test("delayed response creation does not consume the main response capture configuration", async (t) => {
	const app = setup(t);
	await app.start();
	const output = items();
	const message = await app.consume(output);
	app.setBranch([]);
	await app.payload([]);
	await app.payload([]);
	await app.raw({ type: "response.created", response: { id: "warm" } });
	await app.raw({ type: "response.created", response: { id: "resp-1" } });
	await app.raw({ type: "response.completed", response: { id: "warm", output: items("warm") } });
	await app.raw({ type: "response.completed", response: { id: "resp-1", output } });
	await app.end(message);
	assert.deepEqual((await app.payload(project([message]))).input, output);
});

test("shutdown discards unfinalized response data", async (t) => {
	const app = setup(t);
	await app.start();
	const message = await app.consume(items());
	app.setBranch([]);
	await app.begin("resp-1");
	await app.raw({ type: "response.completed", response: { id: "resp-1", output: items() } });
	await app.emit("session_shutdown");
	await app.end(message);
	await app.start();
	assert.deepEqual((await app.payload(project([message]))).input, project([message]));
});
