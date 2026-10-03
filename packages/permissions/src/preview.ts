import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateUnifiedPatch, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, ScrollView, SelectList, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { PERMISSION_OPTIONS, type PermissionSelection } from "./events";

// Tool arguments are untrusted: do not let file contents emit terminal controls.
export function safePreviewText(text: string): string {
	return text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, (character) =>
		`\\x${character.charCodeAt(0).toString(16).padStart(2, "0")}`,
	);
}

export async function buildWritePreview(input: Record<string, unknown>, cwd: string): Promise<string> {
	if (typeof input.path !== "string" || typeof input.content !== "string") {
		return "Cannot preview write: expected path and content strings.";
	}
	const path = input.path;
	// Match the built-in write tool's path normalization (not publicly exported).
	let normalized = path.replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, " ").replace(/^@/, "");
	if (process.platform === "win32" && !normalized.includes("\\") && !normalized.startsWith("//")) {
		normalized = normalized.replace(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i,
			(_match, drive: string, suffix = "") => `${drive.toUpperCase()}:\\${suffix.replaceAll("/", "\\")}`);
	}
	if (normalized === "~") normalized = homedir();
	else if (normalized.startsWith("~/") || (process.platform === "win32" && normalized.startsWith("~\\"))) {
		normalized = resolve(homedir(), normalized.slice(2));
	} else if (normalized.startsWith("file://")) normalized = fileURLToPath(normalized);
	let previous: string;
	try {
		const target = resolve(cwd, normalized);
		if (!(await stat(target)).isFile()) {
			return safePreviewText(`Non-regular destination: ${path}\nShowing proposed content only (not a diff).\n\n${input.content}`);
		}
		previous = await readFile(target, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return safePreviewText(`New file: ${path}\n\n${input.content}`);
		}
		return safePreviewText(`Cannot read existing file: ${path}\nShowing proposed content only (not a diff).\n\n${input.content}`);
	}
	const patch = generateUnifiedPatch(path, previous, input.content);
	return safePreviewText(`Overwrite: ${path}\n\n${previous === input.content ? "No content changes." : patch}`);
}

export async function selectWritePermission(preview: string, ctx: ExtensionContext): Promise<PermissionSelection | null> {
	const selection = await ctx.ui.custom<PermissionSelection | null>((tui, theme, _keys, done) => {
		const text = new Text(preview, 0, 0);
		const scroll = new ScrollView(text, { scrollbar: "hidden" });
		const options = new SelectList(PERMISSION_OPTIONS.map((value) => ({ value, label: value })), 5, {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("muted", text),
			noMatch: (text) => theme.fg("muted", text),
		});
		options.onSelect = (item) => done(item.value as PermissionSelection);
		options.onCancel = () => done(null);
		return {
			render(width: number) {
				const lines = scroll.render(width);
				const optionLines = options.render(width);
				const height = Math.max(1, Math.min(20, tui.terminal.rows - optionLines.length - 4));
				scroll.updateLayout(lines.length, height, () => tui.requestRender());
				return [
					truncateToWidth(theme.fg("accent", "Write preview"), width),
					...lines.slice(scroll.scrollTop, scroll.scrollTop + height),
					"",
					...optionLines,
					truncateToWidth(theme.fg("muted", "PgUp/PgDn Home/End: scroll preview"), width),
					truncateToWidth(theme.fg("muted", "↑/↓: select · Enter: confirm · Esc: deny"), width),
				];
			},
			invalidate() { scroll.invalidate(); options.invalidate(); },
			handleInput(data: string) {
				if (matchesKey(data, Key.pageUp)) scroll.scrollBy(-scroll.viewportHeight);
				else if (matchesKey(data, Key.pageDown)) scroll.scrollBy(scroll.viewportHeight);
				else if (matchesKey(data, Key.home)) scroll.scrollToStart();
				else if (matchesKey(data, Key.end)) scroll.scrollToEnd();
				else options.handleInput(data);
				tui.requestRender();
			},
		};
	});
	return selection ?? null;
}
