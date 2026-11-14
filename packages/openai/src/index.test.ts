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
	const agentDir = join(directory.path, "custom agent");
	const cwd = join(directory.path, "project");
	const configPath = join(cwd, ".pi", "settings.json");
	function writeConfig(value: unknown) {
		mkdirSync(dirname(configPath), { recursive: true });
		writeFileSync(configPath, JSON.stringify(value));
	}
	if (config !== undefined) writeConfig(config);
	const handlers = new Map<string, Handler>();
	const commands = new Map<string, Handler>();
	const tools = new Map<string, any>();
	const statuses = new Map<string, string>();
	const notices: Array<{ message: string; level: string }> = [];
	let branch: any[] = [];
	let oauth = true;
	const ctx = {
		isProjectTrusted: () => true,
		cwd, hasUI: true,
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
		registerTool(tool: any) { tools.set(tool.name, tool); },
		appendEntry(customType: string, data: unknown) { branch.push({ type: "custom", customType, data }); },
	} as any, { agentDir });
	const emit = async (name: string, data: object = {}) => handlers.get(name)?.({ type: name, ...data }, ctx);
	return {
		ctx, notices, statuses, tools, configPath, writeConfig, emit,
		get branch() { return branch; },
		setBranch(value: any[]) { branch = value; },
		setOAuth(value: boolean) { oauth = value; },
		async start() { await emit("session_start"); await emit("turn_start"); },
		command: (args: string) => commands.get("fast")!(args, ctx),
		async payload(payload: any = { model: "test-model" }) {
			return (await emit("before_provider_request", { payload })) ?? payload;
		},
	};
}

test("Fast status follows applicability and the session toggle", async (t) => {
	const app = setup(t);
	await app.start();
	assert.equal(app.statuses.size, 0);
	await app.command("on");
	assert.equal(app.statuses.size, 1);
	app.ctx.model.provider = "anthropic";
	await app.emit("model_select");
	assert.equal(app.statuses.size, 0);
	app.ctx.model.provider = "openai";
	await app.emit("model_select");
	assert.equal(app.statuses.size, 1);
	await app.command("off");
	assert.equal(app.statuses.size, 0);
});

test("default requests omit the service tier and do not enable search", async (t) => {
	const app = setup(t);
	await app.start();
	assert.deepEqual(await app.payload(), { model: "test-model" });
});

for (const [name, model, oauth] of [
	["ChatGPT", {}, true],
	["API key", {}, false],
	["Codex", { provider: "openai-codex", api: "openai-codex-responses", baseUrl: "https://chatgpt.com/backend-api" }, true],
] as const) {
	for (const webSearch of [false, true]) {
		test(`Fast overrides tiers when on and removes them when off for ${name}; search=${webSearch}`, async (t) => {
			const app = setup(t, { openai: { fast: true, webSearch } });
			Object.assign(app.ctx.model, model);
			app.setOAuth(oauth);
			await app.start();
			assert.equal(app.statuses.size, 1);
			const payload = { model: "test-model", service_tier: "flex", tools: [{ type: "function", name: "read" }] };
			const original = structuredClone(payload);
			assert.equal((await app.payload(payload)).service_tier, "priority");
			await app.command("off");
			const result = await app.payload(payload);
			assert.equal(Object.hasOwn(result, "service_tier"), false);
			assert.deepEqual(result.tools, webSearch && name === "ChatGPT" ? [...payload.tools, { type: "web_search" }] : payload.tools);
			assert.deepEqual(payload, original);
			assert.equal(app.statuses.size, 0);
		});
	}
}

test("enabled features preserve payload fields and tools without mutation", async (t) => {
	const app = setup(t, { openai: { fast: true, webSearch: true } });
	await app.start();
	const payload = { model: "test-model", input: [], tools: [{ type: "function", name: "read" }], include: ["reasoning.encrypted_content"], store: false };
	const original = structuredClone(payload);
	const result = await app.payload(payload);
	assert.equal(result.service_tier, "priority");
	assert.deepEqual(result.tools, [...payload.tools, { type: "web_search" }]);
	assert.deepEqual(result.input, []);
	assert.deepEqual(result.include, ["reasoning.encrypted_content", "web_search_call.action.sources"]);
	assert.equal(result.store, false);
	assert.deepEqual(payload, original);
});

test("existing native search configuration is not duplicated or overwritten", async (t) => {
	const app = setup(t, { openai: { webSearch: true } });
	await app.start();
	for (const type of ["web_search", "web_search_2025_08_26", "web_search_preview", "web_search_preview_2025_03_11"]) {
		const tools = [{ type, search_context_size: "low" }];
		const include = ["web_search_call.action.sources", "reasoning.encrypted_content"];
		const payload = { model: "test-model", tools, include };
		const original = structuredClone(payload);
		const result = await app.payload(payload);
		assert.deepEqual(result.tools, tools);
		assert.deepEqual(result.include, include);
		assert.deepEqual(payload, original);
	}
});

for (const [name, model, oauth] of [
	["other providers", { provider: "anthropic" }, true],
	["mismatched Codex API", { provider: "openai-codex" }, true],
	["other APIs", { api: "openai-completions" }, true],
	["custom endpoints", { baseUrl: "https://proxy.example/v1" }, true],
	["lookalike endpoints", { baseUrl: "https://api.openai.com.evil.example/v1" }, true],
	["custom API-key endpoints", { baseUrl: "https://proxy.example/v1" }, false],
	["custom Codex endpoints", { provider: "openai-codex", api: "openai-codex-responses", baseUrl: "https://proxy.example/backend-api" }, true],
	["lookalike Codex endpoints", { provider: "openai-codex", api: "openai-codex-responses", baseUrl: "https://chatgpt.com.evil.example/backend-api" }, true],
] as const) {
	test(`does not change requests for ${name}`, async (t) => {
		const app = setup(t, { openai: { fast: true, webSearch: true } });
		Object.assign(app.ctx.model, model);
		app.setOAuth(oauth);
		await app.start();
		const payload = { model: "test-model", service_tier: "flex" };
		assert.strictEqual(await app.payload(payload), payload);
		assert.equal(app.statuses.size, 0);
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

test("idle cache warming uses the same feature configuration as active requests", async (t) => {
	const app = setup(t, { openai: { fast: true, webSearch: true } });
	await app.start();
	const active = await app.payload();
	await app.emit("turn_end");
	assert.deepEqual(await app.payload(), active);
});

test("image tools follow configured backend/model on reload, independently of the chat provider", async (t) => {
	const app = setup(t, { openai: { imageGeneration: { backend: "codex" } } });
	app.ctx.model.provider = "anthropic";
	await app.start();
	assert.deepEqual(Object.keys(app.tools.get("generate_image").parameters.properties).sort(), ["images", "output", "prompt"]);
	app.writeConfig({ openai: { imageGeneration: { backend: "openai", model: "gpt-image-2.6-flare" } } });
	await app.emit("model_select");
	assert.equal(app.tools.get("generate_image").parameters.properties.quality, undefined);
	await app.start();
	assert.ok(app.tools.get("generate_image").parameters.properties.frame_count);
	app.writeConfig({ openai: { imageGeneration: false } });
	await app.start();
	assert.equal(app.tools.get("generate_image").exposure, "hidden");
	await assert.rejects(app.tools.get("generate_image").execute());
});

test("invalid image config withdraws an already registered tool", async (t) => {
	const app = setup(t, { openai: { imageGeneration: { backend: "codex" } } });
	await app.start();
	app.writeConfig({ openai: { imageGeneration: { backend: "invalid" } } });
	await assert.rejects(app.start());
	assert.equal(app.tools.get("generate_image").exposure, "hidden");
	await assert.rejects(app.tools.get("generate_image").execute());
});
