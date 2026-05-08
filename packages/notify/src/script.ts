import { execFile } from "node:child_process";

export type NotifyPayload = {
	event: "agent_end" | "permission_ask";
	notificationId: string;
	title: "Pi";
	message: string;
	timestamp: number;
	cwd: string;
	pid: number;
	terminal: TerminalContext;
};

export type TerminalContext = {
	term?: string;
	termProgram?: string;
	kittyWindowId?: string;
	weztermPane?: string;
	wtSession?: string;
	tmux?: string;
};

const SCRIPT_TIMEOUT_MS = 5000;

export function runNotifyScript(script: string, payload: NotifyPayload): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = execFile(script, [], { timeout: SCRIPT_TIMEOUT_MS }, (error) => {
			if (error) reject(error);
			else resolve();
		});
		child.stdin?.end(JSON.stringify(payload));
	});
}
