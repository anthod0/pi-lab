import assert from "node:assert/strict";
import { mkdirSync, mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TObject } from "typebox";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

import openai from "./index";

test("real Pi session advertises backend-specific image tools and reload removes obsolete parameters", async (t) => {
	const root = mkdtempDisposableSync(join(tmpdir(), "pi-images-session-"));
	let dispose = () => {};
	t.after(() => { dispose(); root.remove(); });
	const cwd = join(root.path, "project");
	const agentDir = join(root.path, "agent");
	mkdirSync(cwd);
	mkdirSync(agentDir);
	const settingsPath = join(agentDir, "settings.json");
	const configure = (imageGeneration: unknown) => writeFileSync(settingsPath, JSON.stringify({ openai: { imageGeneration } }));
	configure({ backend: "openai", model: "gpt-image-2.6-flare" });
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"), modelsPath: null, modelsStorePath: join(agentDir, "models.json"),
		allowModelNetwork: false, refreshOnCreate: false,
	});
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const resourceLoader = new DefaultResourceLoader({
		cwd, agentDir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
		agentsFilesOverride: () => ({ agentsFiles: [] }), extensionFactories: [(pi) => openai(pi, { agentDir })],
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd, agentDir, resourceLoader, modelRuntime, settingsManager, noTools: "builtin",
		sessionManager: SessionManager.inMemory(cwd),
		model: {
			provider: "anthropic", api: "anthropic-messages", id: "test-model", name: "Test", baseUrl: "https://api.anthropic.com",
			reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 10000, maxTokens: 1000,
		},
	});
	dispose = () => session.dispose();
	const errors: unknown[] = [];
	await session.bindExtensions({ onError: (error) => errors.push(error) });
	assert.deepEqual(errors, []);
	assert.ok(session.getActiveToolNames().includes("generate_image"));
	const imageTool = () => session.getAllTools().find((tool) => tool.name === "generate_image")!;
	assert.ok((imageTool().parameters as TObject).properties.frame_count);
	configure({ backend: "codex" });
	await session.reload();
	assert.deepEqual(errors, []);
	assert.ok(session.getActiveToolNames().includes("generate_image"));
	assert.deepEqual(Object.keys((imageTool().parameters as TObject).properties).sort(), ["images", "output", "prompt"]);
	configure(false);
	await session.reload();
	assert.equal(session.getActiveToolNames().includes("generate_image"), false);
});
