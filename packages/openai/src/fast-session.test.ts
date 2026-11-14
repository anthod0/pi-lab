import assert from "node:assert/strict";
import { mkdirSync, mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { zstdDecompressSync } from "node:zlib";
import { streamSimple as streamOpenAI } from "@earendil-works/pi-ai/api/openai-responses";
import { streamSimple as streamCodex } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

import openai from "./index";

for (const codex of [false, true]) {
	test(`real Pi session applies Fast to ${codex ? "Codex" : "OpenAI API-key"} requests and observes the returned tier`, async (t) => {
		const root = mkdtempDisposableSync(join(tmpdir(), "pi-fast-session-"));
		let dispose = () => {};
		t.after(() => { dispose(); root.remove(); });
		const cwd = join(root.path, "project");
		const agentDir = join(root.path, "agent");
		mkdirSync(cwd);
		mkdirSync(agentDir);
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ openai: { fast: true, webSearch: true } }));
		const modelRuntime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"), modelsPath: null, modelsStorePath: join(agentDir, "models.json"),
			allowModelNetwork: false, refreshOnCreate: false,
		});
		const token = codex
			? `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-account" } })).toString("base64url")}.signature`
			: "sk-test-only-not-a-credential";
		t.mock.method(modelRuntime, "isUsingOAuth", () => codex);
		t.mock.method(modelRuntime, "hasConfiguredAuth", () => true);
		t.mock.method(modelRuntime, "getAuth", async () => ({ auth: { apiKey: token } }));
		const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
		const resourceLoader = new DefaultResourceLoader({
			cwd, agentDir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
			agentsFilesOverride: () => ({ agentsFiles: [] }), extensionFactories: [(pi) => openai(pi, { agentDir })],
		});
		await resourceLoader.reload();
		const manager = SessionManager.inMemory(cwd);
		const { session } = await createAgentSession({
			cwd, agentDir, resourceLoader, modelRuntime, settingsManager, noTools: "builtin", thinkingLevel: "off",
			sessionManager: manager,
			model: {
				provider: codex ? "openai-codex" : "openai", api: codex ? "openai-codex-responses" : "openai-responses",
				baseUrl: codex ? "https://chatgpt.com/backend-api" : "https://api.openai.com/v1",
				id: "test-model", name: "Test", reasoning: false, input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 10000, maxTokens: 1000,
			},
		});
		dispose = () => session.dispose();
		const errors: unknown[] = [];
		const notices: string[] = [];
		await session.bindExtensions({
			onError: (error) => errors.push(error),
			uiContext: {
				theme: { fg: (_color: string, text: string) => text }, setStatus() {},
				notify(message: string) { notices.push(message); },
			} as any,
		});
		const payloads: any[] = [];
		const fetcher: typeof fetch = async (_url, init) => {
			const body = new Headers(init?.headers).get("content-encoding") === "zstd"
				? zstdDecompressSync(init!.body as Uint8Array).toString() : init!.body as string;
			payloads.push(JSON.parse(body));
			const id = `resp_${payloads.length}`;
			const item = { type: "message", id: `msg_${payloads.length}`, role: "assistant", status: "completed",
				content: [{ type: "output_text", text: "Answer", annotations: [] }] };
			const events = [
				{ type: "response.created", response: { id } },
				{ type: "response.output_item.added", output_index: 0, item },
				{ type: "response.output_item.done", output_index: 0, item },
				{ type: codex ? "response.done" : "response.completed", response: { id, status: "completed", output: [item], service_tier: "default" } },
			];
			return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
				headers: { "Content-Type": "text/event-stream" },
			});
		};
		session.agent.streamFunction = ((model: any, context: any, options: any) => (codex ? streamCodex : streamOpenAI)(model, context, {
			...options, apiKey: token, fetch: fetcher, transport: "sse", maxRetries: 0,
		})) as any;
		await session.prompt("First request");
		await session.prompt("/fast status");
		assert.ok(notices.at(-1)?.includes("default"));
		await session.prompt("/fast off");
		await session.prompt("Second request");
		await session.prompt("/fast on");
		await session.prompt("Third request");
		assert.deepEqual(errors, []);
		assert.deepEqual(payloads.map((payload) => payload.service_tier), ["priority", undefined, "priority"]);
		assert.ok(payloads.every((payload) => !payload.tools?.some((tool: any) => tool.type === "web_search")));
		assert.ok(manager.getBranch().every((entry) => entry.type !== "custom" || entry.customType !== "pi-lab:openai-output"));
		assert.deepEqual(session.messages.filter((message) => message.role === "assistant").map((message) => message.stopReason), ["stop", "stop", "stop"]);
	});
}
