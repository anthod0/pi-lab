import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { loadConfig } from "./config.js";

function setupConfigFiles() {
	const testRoot = mkdtempSync(join(tmpdir(), "pi-notify-config-"));
	const home = join(testRoot, "home");
	const cwd = join(testRoot, "project");
	return {
		home,
		cwd,
		global: {
			settings: join(home, ".pi", "agent", "settings.json"),
			legacy: join(home, ".pi", "agent", "pi-lab", "notify.json"),
		},
		local: {
			settings: join(cwd, ".pi", "settings.json"),
			legacy: join(cwd, ".pi", "pi-lab", "notify.json"),
		},
	};
}

function writeJson(filePath: string, value: unknown) {
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, JSON.stringify(value), "utf8");
}

for (const scope of ["global", "local"] as const) {
	test(`loadConfig reads ${scope} settings.json`, () => {
		const files = setupConfigFiles();
		writeJson(files[scope].settings, { notify: { enable: false, script: "~/notify.sh" } });

		assert.deepEqual(loadConfig(files.cwd, files.home), {
			enable: false,
			script: join(files.home, "notify.sh"),
		});
	});

	test(`loadConfig prefers ${scope} settings without inheriting legacy fields`, () => {
		const files = setupConfigFiles();
		writeJson(files[scope].settings, { notify: { enable: true } });
		writeJson(files[scope].legacy, { notify: { enable: false, script: "/legacy.sh" } });

		assert.deepEqual(loadConfig(files.cwd, files.home), { enable: true });
	});

	test(`loadConfig treats an empty ${scope} notify object as configured`, () => {
		const files = setupConfigFiles();
		writeJson(files[scope].settings, { notify: {} });
		writeJson(files[scope].legacy, { notify: { enable: false, script: "/legacy.sh" } });

		assert.deepEqual(loadConfig(files.cwd, files.home), { enable: true });
	});

	for (const notify of [undefined, null, false, [], "invalid"]) {
		test(`loadConfig falls back to ${scope} legacy config when settings notify is ${JSON.stringify(notify)}`, () => {
			const files = setupConfigFiles();
			writeJson(files[scope].settings, { theme: "dark", notify });
			writeJson(files[scope].legacy, { notify: { enable: false, script: "./legacy.sh" } });

			assert.deepEqual(loadConfig(files.cwd, files.home), {
				enable: false,
				script: join(files.cwd, "legacy.sh"),
			});
		});
	}

	test(`loadConfig does not read malformed ${scope} legacy config when settings has notify`, () => {
		const files = setupConfigFiles();
		writeJson(files[scope].settings, { notify: { enable: false } });
		writeJson(files[scope].legacy, {});
		writeFileSync(files[scope].legacy, "{", "utf8");

		assert.deepEqual(loadConfig(files.cwd, files.home), { enable: false });
	});

	test(`loadConfig reports malformed ${scope} settings rather than using legacy config`, () => {
		const files = setupConfigFiles();
		writeJson(files[scope].legacy, { notify: { enable: false } });
		writeFileSync(files[scope].settings, "{", "utf8");

		assert.throws(() => loadConfig(files.cwd, files.home), SyntaxError);
	});
}

for (const globalSource of ["settings", "legacy"] as const) {
	for (const localSource of ["settings", "legacy"] as const) {
		test(`loadConfig merges global ${globalSource} with local ${localSource} field overrides`, () => {
			const files = setupConfigFiles();
			writeJson(files.global[globalSource], { notify: { enable: false, script: "/global.sh" } });
			writeJson(files.local[localSource], { notify: { script: "./local.sh" } });

			assert.deepEqual(loadConfig(files.cwd, files.home), {
				enable: false,
				script: join(files.cwd, "local.sh"),
			});
		});
	}
}

test("loadConfig returns defaults when notify config files are absent", () => {
	const home = mkdtempSync(join(tmpdir(), "pi-notify-home-"));
	const cwd = mkdtempSync(join(tmpdir(), "pi-notify-cwd-"));

	assert.deepEqual(loadConfig(cwd, home), { enable: true });
});

test("loadConfig reads global notify config", () => {
	const home = mkdtempSync(join(tmpdir(), "pi-notify-home-"));
	const cwd = mkdtempSync(join(tmpdir(), "pi-notify-cwd-"));
	mkdirSync(join(home, ".pi", "agent", "pi-lab"), { recursive: true });
	writeFileSync(
		join(home, ".pi", "agent", "pi-lab", "notify.json"),
		JSON.stringify({ notify: { enable: false, script: "~/notify.sh" } }),
		"utf8",
	);

	assert.deepEqual(loadConfig(cwd, home), { enable: false, script: join(home, "notify.sh") });
});

test("loadConfig lets local notify config override global fields", () => {
	const home = mkdtempSync(join(tmpdir(), "pi-notify-home-"));
	const cwd = mkdtempSync(join(tmpdir(), "pi-notify-cwd-"));
	mkdirSync(join(home, ".pi", "agent", "pi-lab"), { recursive: true });
	mkdirSync(join(cwd, ".pi", "pi-lab"), { recursive: true });
	writeFileSync(
		join(home, ".pi", "agent", "pi-lab", "notify.json"),
		JSON.stringify({ notify: { enable: false, script: "/global.sh" } }),
		"utf8",
	);
	writeFileSync(
		join(cwd, ".pi", "pi-lab", "notify.json"),
		JSON.stringify({ notify: { script: "./local.sh" } }),
		"utf8",
	);

	assert.deepEqual(loadConfig(cwd, home), { enable: false, script: join(cwd, "local.sh") });
});

test("loadConfig ignores invalid notify fields", () => {
	const home = mkdtempSync(join(tmpdir(), "pi-notify-home-"));
	const cwd = mkdtempSync(join(tmpdir(), "pi-notify-cwd-"));
	mkdirSync(join(cwd, ".pi", "pi-lab"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "pi-lab", "notify.json"),
		JSON.stringify({ notify: { enable: "no", script: 123 } }),
		"utf8",
	);

	assert.deepEqual(loadConfig(cwd, home), { enable: true });
});
