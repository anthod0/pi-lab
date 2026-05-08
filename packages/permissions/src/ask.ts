import { createHash } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildTitle } from "./format";
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
};

export async function askUser(
	toolName: string,
	input: Record<string, unknown>,
	cache: SessionCache,
	ctx: ExtensionContext
): Promise<AskUserResult> {
	const title = buildTitle(toolName, input);

	const result = (await ctx.ui.select(title, PERMISSION_OPTIONS)) as PermissionSelection | null;

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
