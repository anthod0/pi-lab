import assert from "node:assert/strict";
import { mkdirSync, mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";

import { loadConfig, loadImageConfig } from "./config";

function sandbox(t: TestContext) {
	const directory = mkdtempDisposableSync(join(tmpdir(), "pi-openai-config-"));
	t.after(() => directory.remove());
	const agentDir = join(directory.path, "custom agent");
	const cwd = join(directory.path, "project");
	return {
		agentDir,
		cwd,
		write(scope: "global" | "local", value: unknown) {
			const path = scope === "global"
				? join(agentDir, "settings.json")
				: join(cwd, ".pi", "settings.json");
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
		},
	};
}

test("missing config files disable both features", (t) => {
	const { cwd, agentDir } = sandbox(t);
	assert.deepEqual(loadConfig(cwd, agentDir), { fast: false, webSearch: false });
});

test("project values override individual global values, including explicit false", (t) => {
	const app = sandbox(t);
	app.write("global", { openai: { fast: true, webSearch: true } });
	app.write("local", { openai: { fast: false } });
	assert.deepEqual(loadConfig(app.cwd, app.agentDir), { fast: false, webSearch: true });
});

test("an empty config section leaves defaults intact", (t) => {
	const app = sandbox(t);
	app.write("global", {});
	app.write("local", { openai: {} });
	assert.deepEqual(loadConfig(app.cwd, app.agentDir), { fast: false, webSearch: false });
});

for (const invalid of ["{", null, [], { openai: null }, { openai: [] },
	{ openai: { fast: "true" } }, { openai: { webSearch: 1 } }, { openai: { webSerch: true } }]) {
	test(`rejects invalid configuration ${JSON.stringify(invalid)}`, (t) => {
		const app = sandbox(t);
		app.write("local", invalid);
		assert.throws(() => loadConfig(app.cwd, app.agentDir));
	});
}

test("a valid local override does not hide an invalid global config", (t) => {
	const app = sandbox(t);
	app.write("global", { openai: { fast: "yes" } });
	app.write("local", { openai: { fast: false } });
	assert.throws(() => loadConfig(app.cwd, app.agentDir));
});

test("image backend configuration replaces the global selection and can be disabled locally", (t) => {
	const app = sandbox(t);
	app.write("global", { openai: { webSearch: true, imageGeneration: { backend: "openai", model: "gpt-image-2.6-flare" } } });
	app.write("local", { openai: { imageGeneration: { backend: "codex" } } });
	assert.deepEqual(loadConfig(app.cwd, app.agentDir), { fast: false, webSearch: true });
	assert.deepEqual(loadImageConfig(app.cwd, app.agentDir), { backend: "codex" });
	app.write("local", { openai: { imageGeneration: false } });
	assert.equal(loadImageConfig(app.cwd, app.agentDir), false);
});

test("untrusted project image configuration cannot select a billing backend", (t) => {
	const app = sandbox(t);
	app.write("global", { openai: { imageGeneration: { backend: "codex" } } });
	app.write("local", { openai: { imageGeneration: { backend: "openai", model: "gpt-image-2" } } });
	assert.deepEqual(loadImageConfig(app.cwd, app.agentDir, false), { backend: "codex" });
});

for (const imageGeneration of [true, null, {}, { backend: "unknown" }, { backend: "codex", model: "gpt-image-2" },
	{ backend: "openai" }, { backend: "openai", model: "unknown" }, { backend: "openai", model: "toString" },
	{ backend: "openai", model: "gpt-image-2", apiKey: "key" }]) {
	test(`invalid image config fails explicitly: ${JSON.stringify(imageGeneration)}`, (t) => {
		const app = sandbox(t);
		app.write("global", { openai: { imageGeneration } });
		assert.throws(() => loadImageConfig(app.cwd, app.agentDir));
		assert.deepEqual(loadConfig(app.cwd, app.agentDir), { fast: false, webSearch: false });
	});
}
