import assert from "node:assert/strict";
import { mkdirSync, mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";

import { loadConfig } from "./config";

function sandbox(t: TestContext) {
	const directory = mkdtempDisposableSync(join(tmpdir(), "pi-openai-config-"));
	t.after(() => directory.remove());
	const home = join(directory.path, "home");
	const cwd = join(directory.path, "project");
	return {
		home,
		cwd,
		write(scope: "global" | "local", value: unknown) {
			const path = scope === "global"
				? join(home, ".pi", "agent", "pi-lab", "openai.json")
				: join(cwd, ".pi", "pi-lab", "openai.json");
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
		},
	};
}

test("missing config files disable both features", (t) => {
	const { cwd, home } = sandbox(t);
	assert.deepEqual(loadConfig(cwd, home), { fast: false, webSearch: false });
});

test("project values override individual global values, including explicit false", (t) => {
	const app = sandbox(t);
	app.write("global", { openai: { fast: true, webSearch: true } });
	app.write("local", { openai: { fast: false } });
	assert.deepEqual(loadConfig(app.cwd, app.home), { fast: false, webSearch: true });
});

test("an empty config section leaves defaults intact", (t) => {
	const app = sandbox(t);
	app.write("global", {});
	app.write("local", { openai: {} });
	assert.deepEqual(loadConfig(app.cwd, app.home), { fast: false, webSearch: false });
});

for (const invalid of ["{", null, [], { openai: null }, { openai: [] },
	{ openai: { fast: "true" } }, { openai: { webSearch: 1 } }, { openai: { webSerch: true } }]) {
	test(`rejects invalid configuration ${JSON.stringify(invalid)}`, (t) => {
		const app = sandbox(t);
		app.write("local", invalid);
		assert.throws(() => loadConfig(app.cwd, app.home));
	});
}

test("a valid local override does not hide an invalid global config", (t) => {
	const app = sandbox(t);
	app.write("global", { openai: { fast: "yes" } });
	app.write("local", { openai: { fast: false } });
	assert.throws(() => loadConfig(app.cwd, app.home));
});
