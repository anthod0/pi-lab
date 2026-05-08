import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, type PermissionConfig, type Rule } from "./config";
import { sortRules, evaluate } from "./rules";
import { SessionCache, askUser } from "./ask";
import {
	PERMISSION_OPTIONS,
	PERMISSIONS_ASK_EVENT,
	PERMISSIONS_DENY_EVENT,
	PERMISSIONS_USER_SELECT_EVENT,
	emitPermissionEvent,
	serializeRule,
	type PermissionsDenySource,
} from "./events";

export default function (pi: ExtensionAPI) {
	let sortedRules: ReturnType<typeof sortRules> = [];
	const cache = new SessionCache();

	pi.on("session_start", async (_event, ctx) => {
		const config: PermissionConfig = loadConfig(ctx.cwd);
		sortedRules = sortRules(config.rules);
		cache.clear();
	});

	pi.on("tool_call", async (event, ctx) => {
		const input = event.input as Record<string, unknown>;
		const result = evaluate(event.toolName, input, sortedRules);

		if (!result) return undefined;

		const { action, rule } = result;

		if (action === "allow") return undefined;

		if (action === "deny") {
			const reason = rule.message ?? "Blocked by permissions";
			emitDeny(pi.events, event.toolCallId, event.toolName, reason, "rule", rule);
			return { block: true, reason };
		}

		// action === "ask"
		const cached = cache.get(event.toolName, input);
		if (cached === "allow") return undefined;
		if (cached === "deny") {
			const reason = rule.message ?? "Blocked by permissions";
			emitDeny(pi.events, event.toolCallId, event.toolName, reason, "cache", rule);
			return { block: true, reason };
		}

		if (!ctx.hasUI) {
			const reason = "ask rule requires UI";
			emitDeny(pi.events, event.toolCallId, event.toolName, reason, "no_ui", rule);
			return { block: true, reason };
		}

		emitPermissionEvent(pi.events, PERMISSIONS_ASK_EVENT, {
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			rule: serializeRule(rule),
			options: PERMISSION_OPTIONS,
		});
		const userResult = await askUser(event.toolName, input, cache, ctx);
		emitPermissionEvent(pi.events, PERMISSIONS_USER_SELECT_EVENT, {
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			selection: userResult.selection,
			decision: userResult.decision,
			cached: userResult.cached,
			rule: serializeRule(rule),
		});

		if (userResult.decision === "allow") return undefined;

		const reason = rule.message ?? "Blocked by user";
		emitDeny(pi.events, event.toolCallId, event.toolName, reason, "user", rule);
		return { block: true, reason };
	});
}

function emitDeny(
	events: ExtensionAPI["events"],
	toolCallId: string,
	toolName: string,
	reason: string,
	source: PermissionsDenySource,
	rule: Rule,
): void {
	emitPermissionEvent(events, PERMISSIONS_DENY_EVENT, {
		toolCallId,
		toolName,
		reason,
		source,
		rule: serializeRule(rule),
	});
}
