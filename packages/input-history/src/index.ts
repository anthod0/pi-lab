import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const MAX_HISTORY = 100;
const SEPARATOR = "\x00"; // null byte separates entries (supports multi-line inputs)

// Use pi's own session directory for this project via SessionManager API
function historyFile(sessionDir: string): string {
	return join(sessionDir, "input-history");
}

async function loadHistory(sessionDir: string): Promise<string[]> {
	try {
		const data = await readFile(historyFile(sessionDir), "utf8");
		return data.split(SEPARATOR).filter(Boolean);
	} catch {
		return [];
	}
}

async function saveHistory(sessionDir: string, history: string[]): Promise<void> {
	await mkdir(sessionDir, { recursive: true });
	await writeFile(historyFile(sessionDir), history.join(SEPARATOR), "utf8");
}

export default function (pi: ExtensionAPI) {
	let history: string[] = [];
	let sessionDir = "";

	pi.on("session_start", async (_event, ctx) => {
		sessionDir = ctx.sessionManager.getSessionDir() ?? "";
		history = sessionDir ? await loadHistory(sessionDir) : [];

		ctx.ui.setEditorComponent((tui, theme, kb) => {
			class HistoryEditor extends CustomEditor {
				private globalIdx = -1;
				private savedText = "";

				handleInput(data: string): void {
					if (matchesKey(data, "up")) {
						if (this.getText().trim() === "" || this.globalIdx > -1) {
							if (this.globalIdx === -1) {
								this.savedText = this.getText();
							}
							const newIndex = this.globalIdx + 1;
							if (newIndex < history.length) {
								this.globalIdx = newIndex;
								this.setText(history[newIndex]!);
							}
							return;
						}
						super.handleInput(data);
						return;
					}

					if (matchesKey(data, "down")) {
						if (this.globalIdx > -1) {
							const newIndex = this.globalIdx - 1;
							this.globalIdx = newIndex;
							this.setText(newIndex < 0 ? this.savedText : history[newIndex]!);
							return;
						}
						super.handleInput(data);
						return;
					}

					this.globalIdx = -1;
					super.handleInput(data);
				}
			}

			return new HistoryEditor(tui, theme, kb);
		});
	});

	pi.on("input", async (event, _ctx) => {
		if (event.source !== "interactive") return { action: "continue" as const };
		const text = event.text.trim();
		if (!text) return { action: "continue" as const };

		history = [text, ...history.filter((h) => h !== text)];
		if (history.length > MAX_HISTORY) {
			history = history.slice(0, MAX_HISTORY);
		}
		if (sessionDir) await saveHistory(sessionDir, history);

		return { action: "continue" as const };
	});
}
