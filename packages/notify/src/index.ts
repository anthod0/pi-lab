import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { loadConfig, type NotifyConfig } from "./config.js";
import { sendDesktopNotification } from "./notifier.js";
import { runNotifyScript, type NotifyPayload, type TerminalContext } from "./script.js";

type PermissionsAskEvent = {
	toolCallId?: unknown;
	toolName?: unknown;
};

type NotifyDeps = {
	home?: string;
	sendNotification?: (title: string, message: string) => void;
	runScript?: (script: string, payload: NotifyPayload) => void | Promise<void>;
	warn?: (message: string) => void;
};

const TITLE = "Pi" as const;
const AGENT_END_MESSAGE = "Ready for input";

export default function (pi: ExtensionAPI, deps: NotifyDeps = {}) {
	let config: NotifyConfig = { enable: true };
	let currentCwd = process.cwd();

	const sendNotification = deps.sendNotification ?? sendDesktopNotification;
	const runScript = deps.runScript ?? runNotifyScript;
	const warn = deps.warn ?? ((message: string) => console.warn(message));

	pi.on("session_start", async (_event, ctx) => {
		currentCwd = ctx.cwd;
		config = loadConfig(ctx.cwd, deps.home);
	});

	pi.on("agent_end", async () => {
		await handleNotify(createPayload("agent_end", AGENT_END_MESSAGE));
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
			notificationId: `${event === "agent_end" ? "pi-agent-end" : "pi-permission-ask"}-${timestamp}`,
			title: TITLE,
			message,
			timestamp,
			cwd: currentCwd,
			pid: process.pid,
			terminal: getTerminalContext(),
		};
	}

	async function handleNotify(payload: NotifyPayload): Promise<void> {
		if (config.enable) {
			sendNotification(payload.title, payload.message);
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

function getTerminalContext(): TerminalContext {
	return {
		term: process.env.TERM,
		termProgram: process.env.TERM_PROGRAM,
		kittyWindowId: process.env.KITTY_WINDOW_ID,
		weztermPane: process.env.WEZTERM_PANE,
		wtSession: process.env.WT_SESSION,
		tmux: process.env.TMUX,
	};
}
