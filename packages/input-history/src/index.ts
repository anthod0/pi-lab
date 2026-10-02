import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
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

		const existingEditorFactory = ctx.ui.getEditorComponent();
		ctx.ui.setEditorComponent((tui, theme, kb) => {
			const editor = existingEditorFactory?.(tui, theme, kb) ?? new CustomEditor(tui, theme, kb);

			// addToHistory prepends entries, so load oldest first to preserve newest-first order.
			for (let index = history.length - 1; index >= 0; index--) {
				editor.addToHistory?.(history[index]!);
			}

			return editor;
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
