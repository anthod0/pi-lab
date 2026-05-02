import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import permissions from "./index.js";

type Handler = (event: any, ctx: any) => Promise<any>;

function setup(rules: unknown[], options: { hasUI?: boolean; selections?: (string | null)[] } = {}) {
	const cwd = mkdtempSync(join(tmpdir(), "pi-permissions-events-cwd-"));
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ permissions: { rules } }), "utf8");

	const emitted: Array<{ name: string; payload: any }> = [];
	const handlers: Record<string, Handler> = {};
	const selections = [...(options.selections ?? [])];
	const pi = {
		on(name: string, handler: Handler) {
			handlers[name] = handler;
		},
		events: {
			emit(name: string, payload: any) {
				emitted.push({ name, payload });
			},
		},
	};
	permissions(pi as any);

	const ctx = {
		cwd,
		hasUI: options.hasUI ?? false,
		ui: {
			async select(_title: string, _options: string[]) {
				return selections.shift() ?? null;
			},
		},
	};

	return {
		emitted,
		async start() {
			await handlers.session_start({ type: "session_start" }, ctx);
		},
		async toolCall(input: Record<string, unknown>, toolCallId = "call-1", toolName = "bash") {
			return handlers.tool_call({ type: "tool_call", toolCallId, toolName, input }, ctx);
		},
	};
}

const denyRule = {
	message: "No rm",
	priority: 5,
	match: { tool: "bash", params: { command: "rm\\s+-rf" } },
	action: "deny",
};

const askRule = {
	message: "Confirm sudo",
	priority: 99,
	match: { tool: "bash", params: { command: "sudo" } },
	action: "ask",
};

test("direct deny emits permissions:deny with source rule and no input", async () => {
	const app = setup([denyRule]);
	await app.start();

	const result = await app.toolCall({ command: "rm -rf /tmp/actual-secret" }, "deny-1");

	assert.deepEqual(result, { block: true, reason: "No rm" });
	assert.deepEqual(app.emitted, [
		{
			name: "permissions:deny",
			payload: {
				toolCallId: "deny-1",
				toolName: "bash",
				reason: "No rm",
				source: "rule",
				rule: denyRule,
			},
		},
	]);
	assert.equal(JSON.stringify(app.emitted).includes("/tmp/actual-secret"), false);
	assert.equal(JSON.stringify(app.emitted).includes("\"input\""), false);
});

test("ask without UI emits permissions:deny with source no_ui", async () => {
	const app = setup([askRule], { hasUI: false });
	await app.start();

	const result = await app.toolCall({ command: "sudo reboot" }, "noui-1");

	assert.deepEqual(result, { block: true, reason: "ask rule requires UI" });
	assert.equal(app.emitted.length, 1);
	assert.equal(app.emitted[0].name, "permissions:deny");
	assert.equal(app.emitted[0].payload.source, "no_ui");
	assert.equal(app.emitted[0].payload.reason, "ask rule requires UI");
});

test("real ask emits ask before user_select and allow selection does not deny", async () => {
	const app = setup([askRule], { hasUI: true, selections: ["Allow"] });
	await app.start();

	const result = await app.toolCall({ command: "sudo true" }, "ask-1");

	assert.equal(result, undefined);
	assert.deepEqual(app.emitted.map((event) => event.name), ["permissions:ask", "permissions:user_select"]);
	assert.deepEqual(app.emitted[0].payload.options, ["Allow", "Allow always", "Deny", "Deny always"]);
	assert.equal(app.emitted[1].payload.selection, "Allow");
	assert.equal(app.emitted[1].payload.decision, "allow");
	assert.equal(app.emitted[1].payload.cached, false);
});

test("user deny emits user_select then permissions:deny with source user", async () => {
	const app = setup([askRule], { hasUI: true, selections: ["Deny"] });
	await app.start();

	const result = await app.toolCall({ command: "sudo false" }, "user-deny-1");

	assert.deepEqual(result, { block: true, reason: "Confirm sudo" });
	assert.deepEqual(app.emitted.map((event) => event.name), ["permissions:ask", "permissions:user_select", "permissions:deny"]);
	assert.equal(app.emitted[1].payload.selection, "Deny");
	assert.equal(app.emitted[1].payload.decision, "deny");
	assert.equal(app.emitted[2].payload.source, "user");
});

test("ask cache deny emits permissions:deny with source cache without prompting", async () => {
	const app = setup([askRule], { hasUI: true, selections: ["Deny always"] });
	await app.start();

	await app.toolCall({ command: "sudo whoami" }, "first");
	app.emitted.length = 0;
	const result = await app.toolCall({ command: "sudo whoami" }, "second");

	assert.deepEqual(result, { block: true, reason: "Confirm sudo" });
	assert.deepEqual(app.emitted.map((event) => event.name), ["permissions:deny"]);
	assert.equal(app.emitted[0].payload.source, "cache");
	assert.equal(app.emitted[0].payload.toolCallId, "second");
});
