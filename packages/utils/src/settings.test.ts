import assert from "node:assert/strict";
import { mkdtempDisposableSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { mergePiSettings, readMergedPiSettings, readPiProjectSettings, readPiUserSettings } from "./settings.js";

function fixture(t: TestContext) {
	const testRoot = mkdtempDisposableSync(join(tmpdir(), "pi-lab-settings-"));
	t.after(() => testRoot.remove());
	const cwd = join(testRoot.path, "project");
	const agentDir = join(testRoot.path, "custom agent");
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	mkdirSync(agentDir, { recursive: true });
	return {
		cwd, agentDir,
		writeProject(text: string) { writeFileSync(join(cwd, ".pi", "settings.json"), text); },
		writeUser(text: string) { writeFileSync(join(agentDir, "settings.json"), text); },
	};
}

test("readPiProjectSettings parses settings from the supplied project", (t) => {
	const files = fixture(t);
	files.writeProject(JSON.stringify({ defaultModel: "sonnet", compaction: { enabled: false } }));
	assert.deepEqual(readPiProjectSettings(files.cwd), {
		defaultModel: "sonnet", compaction: { enabled: false },
	});
});

test("readPiUserSettings parses settings from the supplied agent directory", (t) => {
	const files = fixture(t);
	files.writeUser(JSON.stringify({ theme: "dark", enabledModels: ["claude-*"] }));
	assert.deepEqual(readPiUserSettings(files.agentDir), { theme: "dark", enabledModels: ["claude-*"] });
});

test("settings readers keep project and user scopes separate", (t) => {
	const files = fixture(t);
	files.writeProject(JSON.stringify({ permissions: { rules: [{ match: { tool: "read" }, action: "deny" }] } }));
	files.writeUser(JSON.stringify({ permissions: { rules: [{ match: { tool: "bash" }, action: "ask" }] } }));
	assert.deepEqual(readPiProjectSettings(files.cwd), {
		permissions: { rules: [{ match: { tool: "read" }, action: "deny" }] },
	});
	assert.deepEqual(readPiUserSettings(files.agentDir), {
		permissions: { rules: [{ match: { tool: "bash" }, action: "ask" }] },
	});
});

test("settings readers return empty objects when settings.json is missing", (t) => {
	const files = fixture(t);
	assert.deepEqual(readPiProjectSettings(files.cwd), {});
	assert.deepEqual(readPiUserSettings(files.agentDir), {});
});

test("settings readers throw invalid JSON errors", (t) => {
	const files = fixture(t);
	files.writeProject("{");
	files.writeUser("{");
	assert.throws(() => readPiProjectSettings(files.cwd), SyntaxError);
	assert.throws(() => readPiUserSettings(files.agentDir), SyntaxError);
});

test("mergePiSettings deep merges project settings over user settings", () => {
	assert.deepEqual(mergePiSettings(
		{
			theme: "dark",
			xsearch: { model: "user-model", enableImageUnderstanding: true, allowedModels: ["a", "b"] },
		},
		{ xsearch: { model: "project-model", allowedModels: ["c"] } },
	), {
		theme: "dark",
		xsearch: { model: "project-model", enableImageUnderstanding: true, allowedModels: ["c"] },
	});
});

test("readMergedPiSettings reads user and project settings and applies project overrides", (t) => {
	const files = fixture(t);
	files.writeUser(JSON.stringify({ xsearch: { model: "user-model", enableVideoUnderstanding: true } }));
	files.writeProject(JSON.stringify({ xsearch: { model: "project-model" } }));
	assert.deepEqual(readMergedPiSettings({ cwd: files.cwd, agentDir: files.agentDir }), {
		xsearch: { model: "project-model", enableVideoUnderstanding: true },
	});
});
