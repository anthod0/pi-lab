import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { loadConfig, type NotifyConfig } from "./config.js";
import { sendDesktopNotification, sendTmuxWindowAlert } from "./notifier.js";
import { runNotifyScript, type NotifyPayload, type TerminalContext } from "./script.js";

type PermissionsAskEvent = {
	toolCallId?: unknown;
	toolName?: unknown;
};

type NotifyDeps = {
	home?: string;
	env?: NodeJS.ProcessEnv;
	sendNotification?: (title: string, message: string) => void;
	sendTmuxAlert?: () => void;
	runScript?: (script: string, payload: NotifyPayload) => void | Promise<void>;
	warn?: (message: string) => void;
};

const TITLE = "Pi" as const;
const AGENT_SETTLED_MESSAGE = "Ready for input";

export default function (pi: ExtensionAPI, deps: NotifyDeps = {}) {
	let config: NotifyConfig = { enable: true };
	let currentCwd = process.cwd();

	const env = deps.env ?? process.env;
	const sendNotification = deps.sendNotification ?? sendDesktopNotification;
	const sendTmuxAlert = deps.sendTmuxAlert ?? sendTmuxWindowAlert;
	const runScript = deps.runScript ?? runNotifyScript;
	const warn = deps.warn ?? ((message: string) => console.warn(message));

	pi.on("session_start", async (_event, ctx) => {
		currentCwd = ctx.cwd;
		config = loadConfig(ctx.cwd, deps.home);
	});

	pi.on("agent_settled", async () => {
		await handleNotify(createPayload("agent_settled", AGENT_SETTLED_MESSAGE));
	});

	pi.events.on("permissions:ask", (data: unknown) => {
		const event = isPermissionsAskEvent(data) ? data : {};
		const toolName = typeof event.toolName === "string" ? event.toolName : "unknown";
		void handleNotify(createPayload("permission_ask", `Permission required: ${toolName}`));
	});

	function createPayload(event: NotifyPayload["event"], message: string): NotifyPayload {
		const timestamp = Date.now();
		return {
			event,
			notificationId: `${event === "agent_settled" ? "pi-agent-settled" : "pi-permission-ask"}-${timestamp}`,
			title: TITLE,
			message,
			timestamp,
			cwd: currentCwd,
			pid: process.pid,
			terminal: getTerminalContext(env),
		};
	}

	async function handleNotify(payload: NotifyPayload): Promise<void> {
		if (config.enable) {
			sendNotification(payload.title, payload.message);
			if (payload.terminal.tmux) {
				sendTmuxAlert();
			}
		}
		if (config.script) {
			try {
				await runScript(config.script, payload);
			} catch (error) {
				warn(`notify script failed: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	}
}

function isPermissionsAskEvent(value: unknown): value is PermissionsAskEvent {
	return typeof value === "object" && value !== null;
}

function getTerminalContext(env: NodeJS.ProcessEnv): TerminalContext {
	return {
		term: env.TERM,
		termProgram: env.TERM_PROGRAM,
		kittyWindowId: env.KITTY_WINDOW_ID,
		weztermPane: env.WEZTERM_PANE,
		wtSession: env.WT_SESSION,
		tmux: env.TMUX,
	};
}
