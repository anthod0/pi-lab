import assert from "node:assert/strict";
import { mkdirSync, mkdtempDisposableSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";

import openai from "./index";

type Handler = (event: any, ctx: any) => any;

function setup(t: TestContext, config?: unknown) {
	const directory = mkdtempDisposableSync(join(tmpdir(), "pi-openai-session-"));
	t.after(() => directory.remove());
	const home = join(directory.path, "home");
	const cwd = join(directory.path, "project");
	const configPath = join(cwd, ".pi", "settings.json");
	function writeConfig(value: unknown) {
		mkdirSync(dirname(configPath), { recursive: true });
		writeFileSync(configPath, JSON.stringify(value));
	}
	if (config !== undefined) writeConfig(config);
	const handlers = new Map<string, Handler>();
	const commands = new Map<string, Handler>();
	const statuses = new Map<string, string>();
	const notices: Array<{ message: string; level: string }> = [];
	let branch: any[] = [];
	let oauth = true;
	const ctx = {
		cwd,
		hasUI: true,
		model: { provider: "openai", api: "openai-responses", id: "test-model", baseUrl: "https://api.openai.com/v1" },
		modelRegistry: { isUsingOAuth: () => oauth },
		sessionManager: { getBranch: () => branch },
		ui: {
			theme: { fg: (_color: string, text: string) => text },
			setStatus(key: string, text: string | undefined) {
				if (text === undefined) statuses.delete(key);
				else statuses.set(key, text);
			},
			notify(message: string, level: string) { notices.push({ message, level }); },
		},
	};
	openai({
		on(name: string, handler: Handler) { handlers.set(name, handler); },
		registerCommand(name: string, command: { handler: Handler }) { commands.set(name, command.handler); },
		appendEntry(customType: string, data: unknown) { branch.push({ type: "custom", customType, data }); },
	} as any, { home });
	const emit = async (name: string, data: object = {}) => handlers.get(name)?.({ type: name, ...data }, ctx);
	const raw = (data: object, metadata: object = {}) => emit("provider_stream_event", {
		provider: "openai", api: "openai-responses", model: "test-model", data, ...metadata,
	});
	return {
		ctx, notices, statuses, configPath, writeConfig, emit, raw,
		get branch() { return branch; },
		setBranch(value: any[]) { branch = value; },
		setOAuth(value: boolean) { oauth = value; },
		async start() {
			await emit("session_start");
			await emit("turn_start");
		},
		command: (args: string) => commands.get("fast")!(args, ctx),
		async payload(payload: any = { model: "test-model" }) {
			return (await emit("before_provider_request", { payload })) ?? payload;
		},
		async begin(id = "resp-1") {
			await this.payload();
			await raw({ type: "response.created", response: { id } });
		},
		async end(message = assistant()) {
			return (await emit("message_end", { message }))?.message ?? message;
		},
	};
}

function assistant(content: any[] = [{ type: "text", text: "Answer." }], extra: object = {}) {
	return {
		role: "assistant", provider: "openai", api: "openai-responses", model: "test-model", responseId: "resp-1",
		content, stopReason: "stop", usage: { totalTokens: 42 }, timestamp: 1, ...extra,
	};
}

function citation(url = "https://example.com/source", extra: object = {}) {
	return { type: "url_citation", url, title: "Source", start_index: 0, end_index: 7, ...extra };
}

function outputItem(text: string, annotations: unknown[]) {
	return { type: "message", id: "msg-1", content: [{ type: "output_text", text, annotations }] };
}

function fullText(message: ReturnType<typeof assistant>): string {
	return message.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n");
}

test("Fast status is only present while enabled on a supported connection", async (t) => {
	const app = setup(t);
	await app.start();
	assert.equal(app.statuses.size, 0);
	await app.command("on");
	assert.equal(app.statuses.has("pi-lab:openai-fast"), true);
	app.setOAuth(false);
	await app.emit("model_select");
	assert.equal(app.statuses.size, 0);
	app.setOAuth(true);
	await app.emit("model_select");
	assert.equal(app.statuses.has("pi-lab:openai-fast"), true);
	await app.command("off");
	assert.equal(app.statuses.size, 0);
});

test("native search does not publish status while preserving source links", async (t) => {
	const app = setup(t, { openai: { webSearch: true } });
	await app.start();
	await app.begin();
	for (const type of ["response.web_search_call.in_progress", "response.web_search_call.searching"]) {
		await app.raw({ type });
		assert.equal(app.statuses.size, 0);
	}
	await app.raw({ type: "response.output_text.annotation.added", annotation: citation() });
	assert.ok(fullText(await app.end()).includes("https://example.com/source"));
	assert.equal(app.statuses.size, 0);
});

test("default requests omit the service tier and do not enable search", async (t) => {
	const app = setup(t);
	await app.start();
	assert.deepEqual(await app.payload(), { model: "test-model" });
});

for (const webSearch of [false, true]) {
	test(`Fast overrides existing tiers when on and removes them when off; search=${webSearch}`, async (t) => {
		const app = setup(t, { openai: { fast: true, webSearch } });
		await app.start();
		const payload = { model: "test-model", service_tier: "flex", tools: [{ type: "function", name: "read" }] };
		const original = structuredClone(payload);
		assert.equal((await app.payload(payload)).service_tier, "priority");
		await app.command("off");
		const result = await app.payload(payload);
		assert.equal(Object.hasOwn(result, "service_tier"), false);
		assert.deepEqual(result.tools, webSearch ? [...payload.tools, { type: "web_search" }] : payload.tools);
		assert.deepEqual(payload, original);
	});
}

test("enabled features preserve existing payload fields and tools without mutation", async (t) => {
	const app = setup(t, { openai: { fast: true, webSearch: true } });
	await app.start();
	const payload = { model: "test-model", input: [], tools: [{ type: "function", name: "read" }], include: ["reasoning.encrypted_content"], store: false };
	const original = structuredClone(payload);
	const result = await app.payload(payload);
	assert.equal(result.service_tier, "priority");
	assert.deepEqual(result.tools, [...payload.tools, { type: "web_search" }]);
	assert.deepEqual(result.input, []);
	assert.deepEqual(result.include, ["reasoning.encrypted_content"]);
	assert.equal(result.store, false);
	assert.deepEqual(payload, original);
});

test("existing native search configuration is not duplicated or overwritten", async (t) => {
	const app = setup(t, { openai: { webSearch: true } });
	await app.start();
	for (const type of ["web_search", "web_search_2025_08_26", "web_search_preview", "web_search_preview_2025_03_11"]) {
		const tools = [{ type, search_context_size: "low" }];
		assert.deepEqual((await app.payload({ model: "test-model", tools })).tools, tools);
	}
});

for (const [name, model, oauth] of [
	["other providers", { provider: "openai-codex" }, true],
	["other APIs", { api: "openai-completions" }, true],
	["custom endpoints", { baseUrl: "https://proxy.example/v1" }, true],
	["lookalike endpoints", { baseUrl: "https://api.openai.com.evil.example/v1" }, true],
	["API keys", {}, false],
] as const) {
	test(`does not change requests for ${name}`, async (t) => {
		const app = setup(t, { openai: { fast: true, webSearch: true } });
		Object.assign(app.ctx.model, model);
		app.setOAuth(oauth);
		await app.start();
		const payload = { model: "test-model", service_tier: "flex" };
		assert.strictEqual(await app.payload(payload), payload);
	});
}

test("does not guess the scope of a request for another model", async (t) => {
	const app = setup(t, { openai: { fast: true, webSearch: true } });
	await app.start();
	const payload = { model: "routed-model" };
	assert.strictEqual(await app.payload(payload), payload);
});

test("Fast commands affect future requests, persist only in the session and reject invalid input", async (t) => {
	const app = setup(t, { openai: { fast: false } });
	await app.start();
	const file = readFileSync(app.configPath, "utf8");
	await app.command("on");
	assert.equal((await app.payload()).service_tier, "priority");
	assert.deepEqual(app.branch.map((entry) => entry.data), [{ fast: true }]);
	await app.command("status");
	assert.equal(app.branch.length, 1);
	await app.command("invalid");
	assert.equal((await app.payload()).service_tier, "priority");
	assert.equal(app.branch.length, 1);
	assert.equal(app.notices.at(-1)?.level, "error");
	await app.command("");
	assert.equal(Object.hasOwn(await app.payload(), "service_tier"), false);
	await app.command("on");
	await app.command("off");
	assert.equal(Object.hasOwn(await app.payload(), "service_tier"), false);
	assert.equal(readFileSync(app.configPath, "utf8"), file);
});

test("resume restores the active branch override; tree navigation and new sessions do not leak state", async (t) => {
	const app = setup(t);
	await app.start();
	await app.command("on");
	const enabledBranch = [...app.branch];
	await app.start();
	assert.equal((await app.payload()).service_tier, "priority");
	app.setBranch([]);
	await app.emit("session_tree");
	assert.equal(Object.hasOwn(await app.payload(), "service_tier"), false);
	app.setBranch(enabledBranch);
	await app.emit("session_tree");
	assert.equal((await app.payload()).service_tier, "priority");
	app.setBranch([]);
	await app.start();
	assert.equal(Object.hasOwn(await app.payload(), "service_tier"), false);
});

test("reload reads config but preserves a saved Fast override", async (t) => {
	const app = setup(t);
	await app.start();
	await app.command("off");
	app.writeConfig({ openai: { fast: true, webSearch: true } });
	await app.start();
	const result = await app.payload();
	assert.equal(Object.hasOwn(result, "service_tier"), false);
	assert.deepEqual(result.tools, [{ type: "web_search" }]);
});

test("invalid config cannot leave a previously enabled configuration active", async (t) => {
	const app = setup(t, { openai: { fast: true, webSearch: true } });
	await app.start();
	app.writeConfig({ openai: { fast: "yes" } });
	await assert.rejects(app.start());
	assert.equal(app.statuses.size, 0);
	const payload = { model: "test-model" };
	assert.strictEqual(await app.payload(payload), payload);
	await app.command("on");
	assert.equal(app.branch.length, 0);
	assert.equal(app.notices.at(-1)?.level, "error");
});

test("native citations become persisted message links without changing tool calls or usage", async (t) => {
	const app = setup(t, { openai: { webSearch: true } });
	await app.start();
	await app.begin();
	const text = "Answer. citeturn0search0";
	const item = outputItem(text, [citation(undefined, { start_index: 8, end_index: text.length })]);
	await app.raw({ type: "response.output_item.done", item });
	await app.raw({ type: "response.completed", response: { id: "resp-1", service_tier: "default", output: [item] } });
	const thinking = { type: "thinking", thinking: "Thinking", thinkingSignature: "opaque" };
	const tool = { type: "toolCall", id: "tool-1", name: "read", arguments: { path: "file" } };
	const message = assistant([thinking, { type: "text", text, textSignature: "signature" }, tool]);
	const result = await app.end(message);
	assert.equal(result.content[0], thinking);
	assert.equal(result.content[2], tool);
	assert.equal(result.content[1].textSignature, "signature");
	assert.ok(result.content[1].text.includes("https://example.com/source"));
	assert.ok(!result.content[1].text.includes("cite"));
	assert.equal(result.usage, message.usage);
	assert.equal(result.stopReason, message.stopReason);
	assert.equal(message.content[1].text, text);
	assert.equal((result.content.at(-1).text.match(/https:\/\/example.com\/source/g) ?? []).length, 1);
});

test("terminal output supplies citations when individual item events are absent", async (t) => {
	const app = setup(t, { openai: { webSearch: true } });
	await app.start();
	await app.begin();
	await app.raw({ type: "response.incomplete", response: { id: "resp-1", output: [outputItem("Answer.", [citation()])] } });
	const result = await app.end(assistant(undefined, { stopReason: "length" }));
	assert.ok(fullText(result).includes("https://example.com/source"));
	assert.equal(result.stopReason, "length");
});

test("failed responses retain supplied citations without converting the failure into success", async (t) => {
	const app = setup(t, { openai: { webSearch: true } });
	await app.start();
	await app.begin();
	await app.raw({ type: "response.failed", response: { id: "resp-1", output: [outputItem("Answer.", [citation()])] } });
	const result = await app.end(assistant(undefined, { stopReason: "error", errorMessage: "provider failure" }));
	assert.ok(fullText(result).includes("https://example.com/source"));
	assert.equal(result.stopReason, "error");
	assert.equal(result.errorMessage, "provider failure");
});

test("annotation events preserve observed sources even on an aborted partial response", async (t) => {
	const app = setup(t, { openai: { webSearch: true } });
	await app.start();
	await app.begin();
	await app.raw({ type: "response.output_text.annotation.added", annotation: citation() });
	const result = await app.end(assistant(undefined, { stopReason: "aborted" }));
	assert.ok(fullText(result).includes("https://example.com/source"));
	assert.equal(result.stopReason, "aborted");
});

test("unreliable citation offsets do not rewrite answer text", async (t) => {
	const app = setup(t, { openai: { webSearch: true } });
	await app.start();
	await app.begin();
	const text = "😀 Answer.";
	await app.raw({ type: "response.output_item.done", item: outputItem(text, [citation(undefined, { start_index: 1, end_index: 8 })]) });
	const result = await app.end(assistant([{ type: "text", text }]));
	assert.equal(result.content[0].text, text);
	assert.ok(fullText(result).includes("https://example.com/source"));
});

test("unsafe URLs are not converted into clickable sources", async (t) => {
	const app = setup(t, { openai: { webSearch: true } });
	await app.start();
	await app.begin();
	await app.raw({ type: "response.output_item.done", item: outputItem("Answer.", [
		citation("javascript:alert(1)"), citation("file:///etc/passwd"), citation("https://user:password@example.com/"), citation("not a URL"),
	]) });
	const message = assistant();
	assert.strictEqual(await app.end(message), message);
});

test("source titles and URL delimiters cannot inject additional Markdown links", async (t) => {
	const app = setup(t, { openai: { webSearch: true } });
	await app.start();
	await app.begin();
	await app.raw({ type: "response.output_text.annotation.added", annotation: citation("https://example.com/a>b", { title: "[x](javascript:alert(1))\n\u001b" }) });
	const result = fullText(await app.end());
	assert.ok(result.includes("https://example.com/a%3Eb"));
	assert.ok(result.includes("\\[x\\]"));
	assert.ok(!result.includes("\u001b"));
});

test("source URL backslashes retain their meaning without escaping Markdown delimiters", async (t) => {
	const app = setup(t, { openai: { webSearch: true } });
	await app.start();
	await app.begin();
	await app.raw({ type: "response.output_text.annotation.added", annotation: citation("https://example.com/?q=\\&x=1") });
	await app.raw({ type: "response.output_text.annotation.added", annotation: citation("https://example.com/?q=\\") });
	const text = fullText(await app.end());
	const destinations = [...text.matchAll(/\]\(<(https?:\/\/[^<>]*)>\)/g)].map((match) => match[1]);
	assert.equal(destinations.length, 2);
	for (const destination of destinations) {
		assert.ok(!destination.includes("\\"));
		assert.equal(new URL(destination).searchParams.get("q"), "\\");
	}
	assert.equal(new URL(destinations[0]).searchParams.get("x"), "1");
});

test("overlapping streams use per-response terminal citations rather than mixing sources", async (t) => {
	const app = setup(t, { openai: { fast: true, webSearch: true } });
	await app.start();
	await app.begin("main");
	await app.raw({ type: "response.output_text.annotation.added", annotation: citation("https://main.example/") });
	await app.begin("warm");
	await app.raw({ type: "response.output_text.annotation.added", annotation: citation("https://warm.example/") });
	await app.raw({ type: "response.completed", response: { id: "warm", service_tier: "priority", output: [outputItem("Warm.", [citation("https://warm.example/")])] } });
	await app.raw({ type: "response.completed", response: { id: "main", service_tier: "default", output: [outputItem("Answer.", [citation("https://main.example/")])] } });
	const result = await app.end(assistant(undefined, { responseId: "main" }));
	assert.ok(fullText(result).includes("https://main.example/"));
	assert.ok(!fullText(result).includes("https://warm.example/"));
});

test("ambiguous partial streams do not guess which response owns a citation", async (t) => {
	const app = setup(t, { openai: { webSearch: true } });
	await app.start();
	await app.begin("main");
	await app.begin("warm");
	await app.raw({ type: "response.output_text.annotation.added", annotation: citation("https://warm.example/") });
	const message = assistant(undefined, { responseId: "main", stopReason: "aborted" });
	assert.strictEqual(await app.end(message), message);
});

test("requests outside an active model turn are left untouched", async (t) => {
	const app = setup(t, { openai: { fast: true, webSearch: true } });
	await app.start();
	await app.emit("turn_end");
	const payload = { model: "test-model" };
	assert.strictEqual(await app.payload(payload), payload);
});

test("unrelated provider events and response IDs cannot attach citations to a message", async (t) => {
	const app = setup(t, { openai: { webSearch: true } });
	await app.start();
	await app.begin();
	await app.raw({ type: "response.output_text.annotation.added", annotation: citation() }, { provider: "other" });
	await app.raw({ type: "response.completed", response: { id: "unrelated", output: [outputItem("Answer.", [citation()])] } });
	const message = assistant();
	assert.strictEqual(await app.end(message), message);
});

test("citations only decorate the matching response and cannot leak to a retry", async (t) => {
	const app = setup(t, { openai: { webSearch: true } });
	await app.start();
	await app.begin();
	await app.raw({ type: "response.output_text.annotation.added", annotation: citation() });
	const unrelated = assistant(undefined, { responseId: "other" });
	assert.strictEqual(await app.end(unrelated), unrelated);
	await app.begin("resp-2");
	const next = assistant(undefined, { responseId: "resp-2" });
	assert.strictEqual(await app.end(next), next);
});

test("disabling search leaves assistant messages unchanged", async (t) => {
	const app = setup(t);
	await app.start();
	await app.begin();
	await app.raw({ type: "response.output_text.annotation.added", annotation: citation() });
	const message = assistant();
	assert.strictEqual(await app.end(message), message);
});

test("non-interactive mode still applies payloads and preserves source links", async (t) => {
	const app = setup(t, { openai: { fast: true, webSearch: true } });
	app.ctx.hasUI = false;
	app.ctx.ui.setStatus = () => { throw new Error("No UI"); };
	await app.start();
	assert.equal((await app.payload()).service_tier, "priority");
	await app.begin();
	await app.raw({ type: "response.web_search_call.searching" });
	await app.raw({ type: "response.output_text.annotation.added", annotation: citation() });
	assert.ok(fullText(await app.end()).includes("https://example.com/source"));
	await app.emit("session_shutdown");
});

test("shutdown releases extension statuses and pending response data", async (t) => {
	const app = setup(t, { openai: { fast: true, webSearch: true } });
	await app.start();
	await app.begin();
	await app.raw({ type: "response.web_search_call.searching" });
	await app.raw({ type: "response.output_text.annotation.added", annotation: citation() });
	await app.emit("session_shutdown");
	assert.equal(app.statuses.size, 0);
	const message = assistant();
	assert.strictEqual(await app.end(message), message);
});
