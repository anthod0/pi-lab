import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import notify from "./index.js";

type EventHandler = (event: any, ctx: any) => Promise<void> | void;
type BusHandler = (payload: any) => void;

function setup(config?: unknown) {
	const home = mkdtempSync(join(tmpdir(), "pi-notify-home-"));
	const cwd = mkdtempSync(join(tmpdir(), "pi-notify-cwd-"));
	if (config) {
		mkdirSync(join(cwd, ".pi", "pi-lab"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "pi-lab", "notify.json"), JSON.stringify(config), "utf8");
	}

	const eventHandlers: Record<string, EventHandler> = {};
	const busHandlers: Record<string, BusHandler> = {};
	const sent: Array<{ title: string; message: string }> = [];
	const scripts: unknown[] = [];
	const warnings: string[] = [];

	const pi = {
		on(name: string, handler: EventHandler) {
			eventHandlers[name] = handler;
		},
		events: {
			on(name: string, handler: BusHandler) {
				busHandlers[name] = handler;
			},
		},
	};

	notify(pi as any, {
		home,
		sendNotification(title, message) {
			sent.push({ title, message });
		},
		runScript(_script, payload) {
			scripts.push(payload);
		},
		warn(message) {
			warnings.push(message);
		},
	});

	return {
		cwd,
		sent,
		scripts,
		warnings,
		async start() {
			await eventHandlers.session_start({ type: "session_start" }, { cwd });
		},
		async agentEnd() {
			await eventHandlers.agent_end({ type: "agent_end", messages: [] }, { cwd });
		},
		permissionAsk(toolName = "bash", toolCallId = "call-1") {
			busHandlers["permissions:ask"]({ toolName, toolCallId, rule: {}, options: [] });
		},
	};
}

test("agent_end sends fixed default notification", async () => {
	const app = setup();
	await app.start();

	await app.agentEnd();

	assert.deepEqual(app.sent, [{ title: "Pi", message: "Ready for input" }]);
});

test("permissions:ask sends fixed default notification with tool name", async () => {
	const app = setup();
	await app.start();

	app.permissionAsk("edit", "edit-call");

	assert.deepEqual(app.sent, [{ title: "Pi", message: "Permission required: edit" }]);
});

test("enable false disables default notifications but keeps script hook", async () => {
	const app = setup({ notify: { enable: false, script: "./notify.sh" } });
	await app.start();

	await app.agentEnd();
	app.permissionAsk("bash", "ask-call");

	assert.deepEqual(app.sent, []);
	assert.equal(app.scripts.length, 2);
	assert.deepEqual(
		app.scripts.map((payload: any) => ({
			event: payload.event,
			title: payload.title,
			message: payload.message,
			cwd: payload.cwd,
			pid: payload.pid,
			notificationIdPrefix: String(payload.notificationId).replace(/-\d+$/, ""),
		})),
		[
			{
				event: "agent_end",
				title: "Pi",
				message: "Ready for input",
				cwd: app.cwd,
				pid: process.pid,
				notificationIdPrefix: "pi-agent-end",
			},
			{
				event: "permission_ask",
				title: "Pi",
				message: "Permission required: bash",
				cwd: app.cwd,
				pid: process.pid,
				notificationIdPrefix: "pi-permission-ask",
			},
		],
	);
	for (const payload of app.scripts as any[]) {
		assert.equal("toolName" in payload, false);
		assert.equal("toolCallId" in payload, false);
		assert.equal(typeof payload.timestamp, "number");
		assert.equal(typeof payload.terminal, "object");
	}
});

test("script payload includes terminal context", async () => {
	const app = setup({ notify: { script: "./notify.sh" } });
	await app.start();

	await app.agentEnd();

	const payload = app.scripts[0] as any;
	assert.deepEqual(payload.terminal, {
		term: process.env.TERM,
		termProgram: process.env.TERM_PROGRAM,
		kittyWindowId: process.env.KITTY_WINDOW_ID,
		weztermPane: process.env.WEZTERM_PANE,
		wtSession: process.env.WT_SESSION,
		tmux: process.env.TMUX,
	});
});

test("script hook errors are warned and do not stop notifications", async () => {
	const home = mkdtempSync(join(tmpdir(), "pi-notify-home-"));
	const cwd = mkdtempSync(join(tmpdir(), "pi-notify-cwd-"));
	mkdirSync(join(cwd, ".pi", "pi-lab"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "pi-lab", "notify.json"), JSON.stringify({ notify: { script: "./notify.sh" } }), "utf8");

	const eventHandlers: Record<string, EventHandler> = {};
	const sent: Array<{ title: string; message: string }> = [];
	const warnings: string[] = [];
	const pi = {
		on(name: string, handler: EventHandler) {
			eventHandlers[name] = handler;
		},
		events: { on() {} },
	};
	notify(pi as any, {
		home,
		sendNotification(title, message) {
			sent.push({ title, message });
		},
		runScript() {
			throw new Error("boom");
		},
		warn(message) {
			warnings.push(message);
		},
	});
	await eventHandlers.session_start({ type: "session_start" }, { cwd });

	await eventHandlers.agent_end({ type: "agent_end", messages: [] }, { cwd });

	assert.deepEqual(sent, [{ title: "Pi", message: "Ready for input" }]);
	assert.equal(warnings.length, 1);
	assert.match(warnings[0], /notify script failed: boom/);
});
