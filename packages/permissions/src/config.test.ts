import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadConfig } from "./config.js";

test("loadConfig reads global and local permissions from pi-lab paths", () => {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-permissions-agentDir-"));
	const cwd = mkdtempSync(join(tmpdir(), "pi-permissions-cwd-"));

	mkdirSync(join(agentDir, "pi-lab"), { recursive: true });
	mkdirSync(join(cwd, ".pi", "pi-lab"), { recursive: true });

	writeFileSync(
		join(agentDir, "pi-lab", "permissions.json"),
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

	const config = loadConfig(cwd, agentDir);

	assert.deepEqual(config.rules, [
		{ match: { tool: "bash" }, action: "allow", priority: 1 },
		{ match: { tool: "read" }, action: "deny", priority: 2 },
	]);
});

test("loadConfig falls back to settings permissions when pi-lab files are missing", () => {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-permissions-agentDir-"));
	const cwd = mkdtempSync(join(tmpdir(), "pi-permissions-cwd-"));

	mkdirSync(agentDir, { recursive: true });
	mkdirSync(join(cwd, ".pi"), { recursive: true });

	writeFileSync(
		join(agentDir, "settings.json"),
		JSON.stringify({
			permissions: {
				rules: [{ match: { tool: "bash" }, action: "ask", priority: 1 }],
			},
		}),
		"utf8",
	);
	writeFileSync(
		join(cwd, ".pi", "settings.json"),
		JSON.stringify({
			permissions: {
				rules: [{ match: { tool: "read" }, action: "deny", priority: 2 }],
			},
		}),
		"utf8",
	);

	const config = loadConfig(cwd, agentDir);

	assert.deepEqual(config.rules, [
		{ match: { tool: "bash" }, action: "ask", priority: 1 },
		{ match: { tool: "read" }, action: "deny", priority: 2 },
	]);
});

test("loadConfig prefers pi-lab permissions over settings permissions per scope", () => {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-permissions-agentDir-"));
	const cwd = mkdtempSync(join(tmpdir(), "pi-permissions-cwd-"));

	mkdirSync(join(agentDir, "pi-lab"), { recursive: true });
	mkdirSync(join(cwd, ".pi", "pi-lab"), { recursive: true });

	writeFileSync(
		join(agentDir, "settings.json"),
		JSON.stringify({ permissions: { rules: [{ match: { tool: "global-settings" }, action: "deny" }] } }),
		"utf8",
	);
	writeFileSync(
		join(cwd, ".pi", "settings.json"),
		JSON.stringify({ permissions: { rules: [{ match: { tool: "local-settings" }, action: "deny" }] } }),
		"utf8",
	);
	writeFileSync(
		join(agentDir, "pi-lab", "permissions.json"),
		JSON.stringify({ rules: [{ match: { tool: "global-legacy" }, action: "allow" }] }),
		"utf8",
	);
	writeFileSync(
		join(cwd, ".pi", "pi-lab", "permissions.json"),
		JSON.stringify({ rules: [{ match: { tool: "local-legacy" }, action: "ask" }] }),
		"utf8",
	);

	const config = loadConfig(cwd, agentDir);

	assert.deepEqual(config.rules, [
		{ match: { tool: "global-legacy" }, action: "allow" },
		{ match: { tool: "local-legacy" }, action: "ask" },
	]);
});

test("loadConfig falls back to settings independently for each scope", () => {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-permissions-agentDir-"));
	const cwd = mkdtempSync(join(tmpdir(), "pi-permissions-cwd-"));

	mkdirSync(join(agentDir, "pi-lab"), { recursive: true });
	mkdirSync(join(cwd, ".pi"), { recursive: true });

	writeFileSync(
		join(agentDir, "pi-lab", "permissions.json"),
		JSON.stringify({ rules: [{ match: { tool: "global-legacy" }, action: "allow" }] }),
		"utf8",
	);
	writeFileSync(
		join(cwd, ".pi", "settings.json"),
		JSON.stringify({ permissions: { rules: [{ match: { tool: "local-settings" }, action: "deny" }] } }),
		"utf8",
	);

	const config = loadConfig(cwd, agentDir);

	assert.deepEqual(config.rules, [
		{ match: { tool: "global-legacy" }, action: "allow" },
		{ match: { tool: "local-settings" }, action: "deny" },
	]);
});
