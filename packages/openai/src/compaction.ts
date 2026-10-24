import { isDeepStrictEqual } from "node:util";
import type { SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";

import { readReplayRecord, type ReplayRecord } from "./replay";

type AgentMessage = SessionBeforeCompactEvent["preparation"]["messagesToSummarize"][number];
type AssistantMessage = Extract<AgentMessage, { role: "assistant" }>;
type ToolCall = Extract<AssistantMessage["content"][number], { type: "toolCall" }>;

/** Enrich only the selected summarization input, never persisted conversation messages. */
export function includeNativeSearch(event: SessionBeforeCompactEvent): void {
	const records = new Map<string, ReplayRecord>();
	const originals = new Map<string, AssistantMessage>();
	for (const entry of event.branchEntries) {
		if (entry.type === "custom" && entry.customType === "pi-lab:openai-output") {
			const record = readReplayRecord(entry.data);
			if (record) records.set(record.responseId, record);
		} else if (entry.type === "message" && entry.message.role === "assistant" && entry.message.responseId) {
			originals.set(entry.message.responseId, entry.message);
		}
	}
	const expand = (messages: AgentMessage[]): AgentMessage[] => messages.flatMap((message) => {
		if (message.role !== "assistant" || message.provider !== "openai" || message.api !== "openai-responses" ||
			!message.responseId || message.stopReason === "error" || message.stopReason === "aborted") return [message];
		const record = records.get(message.responseId);
		// Context edits and earlier compaction hooks must win over saved provider output.
		if (!record || record.model !== message.model || !isDeepStrictEqual(originals.get(message.responseId), message) ||
			!record.output.some((item) => item.type === "web_search_call")) return [message];
		return expandResponse(message, record);
	});
	// Replace the arrays with request-local copies. Their original message objects may be shared with session history.
	event.preparation.messagesToSummarize = expand(event.preparation.messagesToSummarize);
	event.preparation.turnPrefixMessages = expand(event.preparation.turnPrefixMessages);
}

function expandResponse(message: AssistantMessage, record: ReplayRecord): AgentMessage[] {
	const messages: AgentMessage[] = [];
	let blockIndex = 0;
	for (const item of record.output) {
		if (item.type === "web_search_call") {
			if (!item.action || typeof item.action !== "object" || Array.isArray(item.action)) continue;
			const { sources, ...action } = item.action as Record<string, unknown>;
			messages.push({
				...message,
				content: [{
					type: "toolCall", id: item.id, name: "web_search",
					arguments: structuredClone({ ...action, status: item.status }) as ToolCall["arguments"],
				}],
			});
			// OpenAI may return source URLs, but a call's status alone is not a retrieved result.
			// In particular, absent sources do not imply failure or an empty search result.
			if (Array.isArray(sources)) {
				messages.push({
					role: "toolResult", toolCallId: item.id, toolName: "web_search",
					content: [{ type: "text", text: JSON.stringify({ sources }) }],
					isError: item.status === "failed", timestamp: message.timestamp,
				});
			}
			continue;
		}
		const type = item.type === "message" ? "text"
			: item.type === "reasoning" ? "thinking"
			: item.type === "function_call" || item.type === "custom_tool_call" ? "toolCall" : undefined;
		if (!type) continue;
		const block = message.content[blockIndex++];
		if (!block || block.type !== type) return [message];
		// Separate items so Pi's serializer cannot move answer text ahead of the search that produced it.
		messages.push({ ...message, content: [structuredClone(block)] });
	}
	return blockIndex === message.content.length ? messages : [message];
}
