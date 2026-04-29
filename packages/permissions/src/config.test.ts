import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadConfig } from "./config.js";

test("loadConfig reads global and local permissions from pi-lab paths", () => {
	const home = mkdtempSync(join(tmpdir(), "pi-permissions-home-"));
	const cwd = mkdtempSync(join(tmpdir(), "pi-permissions-cwd-"));

	mkdirSync(join(home, ".pi", "agent", "pi-lab"), { recursive: true });
	mkdirSync(join(cwd, ".pi", "pi-lab"), { recursive: true });

	writeFileSync(
		join(home, ".pi", "agent", "pi-lab", "permissions.json"),
		JSON.stringify({
			rules: [{ match: { tool: "bash" }, action: "allow", priority: 1 }],
		}),
		"utf8",
	);
	writeFileSync(
		join(cwd, ".pi", "pi-lab", "permissions.json"),
		JSON.stringify({
			rules: [{ match: { tool: "read" }, action: "deny", priority: 2 }],
		}),
		"utf8",
	);

	const config = loadConfig(cwd, home);

	assert.deepEqual(config.rules, [
		{ match: { tool: "bash" }, action: "allow", priority: 1 },
		{ match: { tool: "read" }, action: "deny", priority: 2 },
	]);
});
