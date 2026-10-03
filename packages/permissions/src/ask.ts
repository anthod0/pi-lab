import { createHash } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildTitle } from "./format";
import { buildWritePreview, safePreviewText, selectWritePermission } from "./preview";
import { PERMISSION_OPTIONS, type PermissionSelection } from "./events";

export class SessionCache {
	private cache: Map<string, "allow" | "deny"> = new Map();

	private callKey(toolName: string, input: Record<string, unknown>): string {
		const raw = JSON.stringify({ tool: toolName, input });
		return createHash("sha256").update(raw).digest("hex");
	}

	get(toolName: string, input: Record<string, unknown>): "allow" | "deny" | undefined {
		return this.cache.get(this.callKey(toolName, input));
	}

	set(toolName: string, input: Record<string, unknown>, decision: "allow" | "deny"): void {
		this.cache.set(this.callKey(toolName, input), decision);
	}

	clear(): void {
		this.cache.clear();
	}
}

export type AskUserResult = {
	selection: PermissionSelection | null;
	decision: "allow" | "deny";
	cached: boolean;
	reason?: string;
};

export async function askUser(
	toolName: string,
	input: Record<string, unknown>,
	cache: SessionCache,
	ctx: ExtensionContext
): Promise<AskUserResult> {
	let result: PermissionSelection | null;
	if (toolName === "write") {
		const preview = await buildWritePreview(input, ctx.cwd);
		result = ctx.mode === "tui"
			? await selectWritePermission(preview, ctx)
			: (await ctx.ui.select(`⚠️ write\n${preview}`, PERMISSION_OPTIONS)) as PermissionSelection | null;
	} else {
		result = (await ctx.ui.select(safePreviewText(buildTitle(toolName, input)), PERMISSION_OPTIONS)) as PermissionSelection | null;
	}

	if (result === "Deny with feedback") {
		const feedback = await ctx.ui.editor("Why are you denying this call?");
		const reason = feedback?.trim();
		return { selection: result, decision: "deny", cached: false, ...(reason ? { reason } : {}) };
	}

	if (result === "Allow always") {
		cache.set(toolName, input, "allow");
		return { selection: result, decision: "allow", cached: true };
	} else if (result === "Deny always") {
		cache.set(toolName, input, "deny");
		return { selection: result, decision: "deny", cached: true };
	} else if (result === "Allow") {
		return { selection: result, decision: "allow", cached: false };
	} else {
		// "Deny" or null (user closed)
		return { selection: result === "Deny" ? result : null, decision: "deny", cached: false };
	}
}
