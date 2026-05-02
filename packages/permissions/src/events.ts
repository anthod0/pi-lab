import type { Rule } from "./config";

export const PERMISSIONS_DENY_EVENT = "permissions:deny";
export const PERMISSIONS_ASK_EVENT = "permissions:ask";
export const PERMISSIONS_USER_SELECT_EVENT = "permissions:user_select";

export type SerializedPermissionRule = {
	action: "allow" | "deny" | "ask";
	message?: string;
	priority?: number;
	match: {
		tool: string;
		params?: Record<string, string>;
		paths?: string[];
		pathParam?: string;
	};
};

export type PermissionsDenySource = "rule" | "cache" | "user" | "no_ui";
export type PermissionSelection = "Allow" | "Allow always" | "Deny" | "Deny always";
export const PERMISSION_OPTIONS: PermissionSelection[] = ["Allow", "Allow always", "Deny", "Deny always"];

export type PermissionsDenyEvent = {
	toolCallId: string;
	toolName: string;
	reason: string;
	source: PermissionsDenySource;
	rule: SerializedPermissionRule;
};

export type PermissionsAskEvent = {
	toolCallId: string;
	toolName: string;
	rule: SerializedPermissionRule;
	options: PermissionSelection[];
};

export type PermissionsUserSelectEvent = {
	toolCallId: string;
	toolName: string;
	selection: PermissionSelection | null;
	decision: "allow" | "deny";
	cached: boolean;
	rule: SerializedPermissionRule;
};

type EventBus = {
	emit(name: string, payload: unknown): void;
};

export function serializeRule(rule: Rule): SerializedPermissionRule {
	return {
		action: rule.action,
		...(rule.message === undefined ? {} : { message: rule.message }),
		...(rule.priority === undefined ? {} : { priority: rule.priority }),
		match: {
			tool: rule.match.tool,
			...(rule.match.params === undefined ? {} : { params: { ...rule.match.params } }),
			...(rule.match.paths === undefined ? {} : { paths: [...rule.match.paths] }),
			...(rule.match.pathParam === undefined ? {} : { pathParam: rule.match.pathParam }),
		},
	};
}

export function emitPermissionEvent(bus: EventBus, name: string, payload: unknown): void {
	try {
		bus.emit(name, payload);
	} catch {
		// Event listeners are observational and must not affect permission behavior.
	}
}
