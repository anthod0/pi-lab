import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { includeNativeSearch } from "./compaction";
import { isNativeWebSearchEnabled, isOpenAIChatGPTModel, loadConfig, type OpenAIConfig } from "./policy";
import { readReplayRecord, ResponseOutput, restoreInput } from "./replay";

const FAST_ENTRY = "pi-lab:openai-fast";
const FAST_STATUS = "pi-lab:openai-fast";
const OUTPUT_ENTRY = "pi-lab:openai-output";
const SEARCH_TOOLS = new Set(["web_search", "web_search_2025_08_26", "web_search_preview", "web_search_preview_2025_03_11"]);

type RequestState = {
	model: string;
	fast: boolean;
	output: ResponseOutput;
	persist: boolean;
	capture: boolean;
	terminal?: boolean;
	tier?: string;
};

export default function openai(pi: ExtensionAPI, options: { home?: string } = {}): void {
	let config: OpenAIConfig | undefined;
	let fast = false;
	let request: RequestState | undefined;
	const responses = new Map<string, RequestState>();
	let turnActive = false;
	let lastTier: string | undefined;

	function updateStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus(FAST_STATUS,
			config && fast && isOpenAIChatGPTModel(ctx) ? ctx.ui.theme.fg("dim", "fast") : undefined,
		);
	}

	function clearRequest(): void {
		request = undefined;
		responses.clear();
	}

	function restoreFast(ctx: ExtensionContext): void {
		fast = config?.fast ?? false;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== FAST_ENTRY) continue;
			const data = object(entry.data);
			if (typeof data?.fast === "boolean") fast = data.fast;
		}
		lastTier = undefined;
		clearRequest();
		updateStatus(ctx);
	}

	pi.on("session_start", (_event, ctx) => {
		config = undefined;
		turnActive = false;
		fast = false;
		lastTier = undefined;
		clearRequest();
		try {
			config = loadConfig(ctx.cwd, options.home);
		} finally {
			updateStatus(ctx);
		}
		restoreFast(ctx);
	});

	pi.on("session_before_compact", (event) => includeNativeSearch(event));
	pi.on("session_tree", (_event, ctx) => restoreFast(ctx));
	pi.on("model_select", (_event, ctx) => {
		lastTier = undefined;
		updateStatus(ctx);
	});
	pi.on("turn_start", () => {
		turnActive = true;
		request = undefined;
	});
	pi.on("turn_end", () => {
		turnActive = false;
		request = undefined;
		// Keep unfinished background streams tracked across turn boundaries for isolation.
		for (const [id, state] of responses) {
			state.persist = false;
			if (state.terminal) responses.delete(id);
		}
	});
	pi.on("agent_settled", () => {
		// Locally cancelled background requests may never emit a provider terminal event.
		// Their uncertain state must not disable capture in subsequent agent runs.
		clearRequest();
	});
	pi.on("session_shutdown", (_event, ctx) => {
		turnActive = false;
		clearRequest();
		if (ctx.hasUI) ctx.ui.setStatus(FAST_STATUS, undefined);
	});

	pi.registerCommand("fast", {
		description: "Toggle OpenAI Fast requests, or use on / off / status (session-local)",
		handler: async (args, ctx) => {
			const command = args.trim();
			if (!["", "on", "off", "status"].includes(command)) {
				ctx.ui.notify("Usage: /fast [on|off|status]", "error");
				return;
			}
			if (!config) {
				ctx.ui.notify("Fix the openai configuration in settings.json and /reload before changing Fast mode.", "error");
				return;
			}
			if (command !== "status") {
				fast = command === "" ? !fast : command === "on";
				pi.appendEntry(FAST_ENTRY, { fast });
				lastTier = undefined;
			}
			updateStatus(ctx);
			ctx.ui.notify(
				`Fast requests: ${fast ? "on" : "off"}. ` +
				(isOpenAIChatGPTModel(ctx)
					? "Applies to the next request." +
						(lastTier ? ` Last response tier: ${lastTier}.` : "")
					: "Not applicable to the current model/authentication/endpoint."),
				"info",
			);
		},
	});

	pi.on("before_provider_request", (event, ctx) => {
		request = undefined;
		if (!config || !isOpenAIChatGPTModel(ctx)) return;
		const payload = object(event.payload);
		// This hook has no resolved-model metadata. Do not guess for routed/other requests.
		if (!payload || !ctx.model || payload.model !== ctx.model.id) return;
		const webSearch = isNativeWebSearchEnabled(config, ctx);
		if (webSearch && payload.tools !== undefined && !Array.isArray(payload.tools)) {
			throw new Error("OpenAI web search requires an array of request tools");
		}
		request = { model: ctx.model.id, fast, output: new ResponseOutput(), persist: turnActive, capture: webSearch && turnActive };
		updateStatus(ctx);
		const result = { ...payload };
		// Custom entries carry provider data without changing Pi's assistant messages.
		// Only matching items in the actual request are restored, never compacted or edited history.
		if (Array.isArray(payload.input)) {
			const records = ctx.sessionManager.getBranch().flatMap((entry) => {
				if (entry.type !== "custom" || entry.customType !== OUTPUT_ENTRY) return [];
				const record = readReplayRecord(entry.data);
				return record ? [record] : [];
			});
			result.input = restoreInput(payload.input, records, ctx.model.id);
		}
		if (fast) result.service_tier = "priority";
		else delete result.service_tier;
		if (!webSearch) return result;
		const tools: unknown[] = Array.isArray(payload.tools) ? payload.tools : [];
		if (tools.some((tool) => SEARCH_TOOLS.has(String(object(tool)?.type)))) {
			return result;
		}
		return { ...result, tools: [...tools, { type: "web_search" }] };
	});

	pi.on("provider_stream_event", (event) => {
		if (event.provider !== "openai" || event.api !== "openai-responses") return;
		const data = object(event.data);
		if (!data) return;
		const response = object(data.response);
		const id = typeof response?.id === "string" ? response.id : undefined;
		if (data.type === "response.created" && id) {
			// Also track idle/unmanaged streams: their later item events must never be
			// mistaken for a main turn just because they have no response_id field.
			responses.set(id, request?.model === event.model
				? { ...request, output: new ResponseOutput() }
				: { model: event.model, fast: false, output: new ResponseOutput(), persist: false, capture: false });
			return;
		}
		if (data.type === "response.completed" || data.type === "response.incomplete" || data.type === "response.failed") {
			const state = id ? responses.get(id) : undefined;
			if (!state || state.model !== event.model) return;
			state.terminal = true;
			state.output.observe(data);
			const tier = response?.service_tier;
			state.tier = typeof tier === "string" && ["default", "fast", "priority", "auto", "flex", "scale"].includes(tier)
				? tier : undefined;
			if (!state.persist && id) responses.delete(id);
			return;
		}
		if (data.type !== "response.output_item.added" && data.type !== "response.output_item.done") return;
		const active = [...responses.values()].filter((value) => !value.terminal && value.model === event.model);
		const itemId = object(data.item)?.id;
		const owners = typeof itemId === "string" ? active.filter((value) => value.output?.owns(itemId)) : [];
		const explicit = typeof data.response_id === "string" ? responses.get(data.response_id) : undefined;
		const state = typeof data.response_id === "string" ? explicit
			: owners.length === 1 ? owners[0] : active.length === 1 ? active[0] : undefined;
		if (state && !state.terminal && state.model === event.model) state.output?.observe(data);
		else if (data.response_id === undefined) {
			// An unowned item in overlapping streams cannot be attributed. A full terminal
			// snapshot can recover it; an empty snapshot must not bless a partial history.
			for (const value of active) value.output?.invalidate();
		}
	});

	pi.on("message_end", (event, ctx) => {
		const message = event.message;
		if (message.role !== "assistant" || message.provider !== "openai" ||
			message.api !== "openai-responses" || !message.responseId) return;
		const state = responses.get(message.responseId);
		if (!state || !state.persist || message.model !== state.model) return;
		responses.delete(message.responseId);
		// Only a finalized assistant message updates the last observed tier, never a warm-up.
		if (ctx.model?.id === state.model && fast === state.fast && isOpenAIChatGPTModel(ctx)) {
			lastTier = state.tier;
			updateStatus(ctx);
		}
		// Pi deliberately omits failed/aborted responses on replay. Do not resurrect them.
		if (message.stopReason === "error" || message.stopReason === "aborted") return;
		const output = state.capture ? state.output.snapshot() : undefined;
		if (output) {
			// Keep Pi's observed argument projection only for matching edited history.
			// Replay still sends the original argument string, including truncated JSON.
			const toolArguments = Object.fromEntries(message.content.flatMap((part) => {
				if (part.type !== "toolCall") return [];
				const itemId = part.id.split("|")[1];
				return itemId ? [[itemId, structuredClone(part.arguments)]] : [];
			}));
			pi.appendEntry(OUTPUT_ENTRY, { model: state.model, responseId: message.responseId, output, toolArguments });
		}
	});
}

function object(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}
