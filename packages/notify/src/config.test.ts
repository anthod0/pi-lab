import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadConfig } from "./config.js";

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
