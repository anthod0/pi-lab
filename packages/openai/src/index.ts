import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { isNativeWebSearchEnabled, isOpenAIChatGPTModel, loadConfig, type OpenAIConfig } from "./policy";
import { SearchResponse } from "./search";

const FAST_ENTRY = "pi-lab:openai-fast";
const FAST_STATUS = "pi-lab:openai-fast";
const SEARCH_STATUS = "pi-lab:openai-search";
const SEARCH_TOOLS = new Set(["web_search", "web_search_2025_08_26", "web_search_preview", "web_search_preview_2025_03_11"]);

type RequestState = {
	model: string;
	fast: boolean;
	search?: SearchResponse;
	terminal?: boolean;
	tier?: string;
};

export default function openai(pi: ExtensionAPI, options: { home?: string } = {}): void {
	let config: OpenAIConfig | undefined;
	let fast = false;
	let request: RequestState | undefined;
	const responses = new Map<string, RequestState>();
	let overlappingStreams = false;
	let turnActive = false;
	let lastTier: string | undefined;

	function updateStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		let status: string;
		if (!config) status = "Fast: config error";
		else if (!isOpenAIChatGPTModel(ctx)) status = `Fast: n/a (${fast ? "on" : "off"})`;
		else status = `Fast: ${fast ? "on" : "off"}${lastTier ? ` (last: ${lastTier})` : ""}`;
		ctx.ui.setStatus(FAST_STATUS, status);
	}

	function clearRequest(ctx: ExtensionContext): void {
		request = undefined;
		responses.clear();
		overlappingStreams = false;
		if (ctx.hasUI) ctx.ui.setStatus(SEARCH_STATUS, undefined);
	}

	function restoreFast(ctx: ExtensionContext): void {
		fast = config?.fast ?? false;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== FAST_ENTRY) continue;
			const data = object(entry.data);
			if (typeof data?.fast === "boolean") fast = data.fast;
		}
		lastTier = undefined;
		clearRequest(ctx);
		updateStatus(ctx);
	}

	pi.on("session_start", (_event, ctx) => {
		config = undefined;
		turnActive = false;
		fast = false;
		lastTier = undefined;
		clearRequest(ctx);
		try {
			config = loadConfig(ctx.cwd, options.home);
		} finally {
			updateStatus(ctx);
		}
		restoreFast(ctx);
	});

	pi.on("session_tree", (_event, ctx) => restoreFast(ctx));
	pi.on("model_select", (_event, ctx) => {
		lastTier = undefined;
		updateStatus(ctx);
	});
	pi.on("turn_start", (_event, ctx) => {
		turnActive = true;
		clearRequest(ctx);
	});
	pi.on("turn_end", (_event, ctx) => {
		turnActive = false;
		clearRequest(ctx);
	});
	pi.on("session_shutdown", (_event, ctx) => {
		turnActive = false;
		clearRequest(ctx);
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
				ctx.ui.notify("Fix openai.json and /reload before changing Fast mode.", "error");
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
					? "Applies to the next request; ChatGPT subscription support is not verified." +
						(lastTier ? ` Last response tier: ${lastTier}.` : "")
					: "Not applicable to the current model/authentication/endpoint."),
				"info",
			);
		},
	});

	pi.on("before_provider_request", (event, ctx) => {
		request = undefined;
		if (!turnActive || !config || !isOpenAIChatGPTModel(ctx)) return;
		const payload = object(event.payload);
		// This hook has no resolved-model metadata. Do not guess for routed/other requests.
		if (!payload || !ctx.model || payload.model !== ctx.model.id) return;
		const webSearch = isNativeWebSearchEnabled(config, ctx);
		if (webSearch && payload.tools !== undefined && !Array.isArray(payload.tools)) {
			throw new Error("OpenAI web search requires an array of request tools");
		}
		request = { model: ctx.model.id, fast, search: webSearch ? new SearchResponse() : undefined };
		updateStatus(ctx);
		const result = { ...payload, service_tier: fast ? "fast" : "default" };
		if (!webSearch) return result;
		const tools: unknown[] = Array.isArray(payload.tools) ? payload.tools : [];
		if (tools.some((tool) => SEARCH_TOOLS.has(String(object(tool)?.type)))) {
			return result;
		}
		return { ...result, tools: [...tools, { type: "web_search" }] };
	});

	pi.on("provider_stream_event", (event, ctx) => {
		if (!turnActive || event.provider !== "openai" || event.api !== "openai-responses") return;
		const data = object(event.data);
		if (!data) return;
		const response = object(data.response);
		const id = typeof response?.id === "string" ? response.id : undefined;
		if (data.type === "response.created" && id && request?.model === event.model) {
			// Pi can reuse these hooks for overlapping cache-warming streams. Events without
			// a response ID cannot then be attributed safely; rely on terminal snapshots.
			if ([...responses.values()].some((value) => !value.terminal)) overlappingStreams = true;
			responses.set(id, { ...request, search: request.search ? new SearchResponse() : undefined });
		}
		if (data.type === "response.completed" || data.type === "response.incomplete" || data.type === "response.failed") {
			const state = id ? responses.get(id) : undefined;
			if (!state || state.model !== event.model) return;
			state.terminal = true;
			if (state.search && Array.isArray(response?.output)) {
				state.search = new SearchResponse();
				state.search.observe(data);
			} else if (overlappingStreams) {
				state.search = undefined;
			}
			const tier = response?.service_tier;
			state.tier = typeof tier === "string" && ["default", "fast", "priority", "auto", "flex", "scale"].includes(tier)
				? tier : undefined;
			if (ctx.hasUI && ![...responses.values()].some((value) => !value.terminal)) ctx.ui.setStatus(SEARCH_STATUS, undefined);
			return;
		}
		if (overlappingStreams) return;
		const active = [...responses.values()].filter((value) => !value.terminal && value.model === event.model);
		if (active.length !== 1) return;
		active[0].search?.observe(data);
		if (active[0].search && ctx.hasUI && (
			data.type === "response.web_search_call.in_progress" || data.type === "response.web_search_call.searching"
		)) {
			ctx.ui.setStatus(SEARCH_STATUS, "Web search: searching");
		}
	});

	pi.on("message_end", (event, ctx) => {
		const message = event.message;
		if (message.role !== "assistant" || message.provider !== "openai" ||
			message.api !== "openai-responses" || !message.responseId) return;
		const state = responses.get(message.responseId);
		if (!state || message.model !== state.model) return;
		responses.delete(message.responseId);
		if (ctx.hasUI) ctx.ui.setStatus(SEARCH_STATUS, undefined);
		// Only a finalized assistant message updates the last observed tier, never a warm-up.
		if (ctx.model?.id === state.model && fast === state.fast && isOpenAIChatGPTModel(ctx)) {
			lastTier = state.tier;
			updateStatus(ctx);
		}
		const search = overlappingStreams && !state.terminal ? undefined : state.search;
		const sources = search?.formatSources();
		if (!search || !sources) return;
		// Preserve thinking, local tool calls, signatures, usage and stop reasons.
		const content = message.content.map((part) => part.type === "text"
			? { ...part, text: search.formatText(part.text) }
			: part);
		content.push({ type: "text", text: sources.trimStart() });
		return { message: { ...message, content } };
	});
}

function object(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}
