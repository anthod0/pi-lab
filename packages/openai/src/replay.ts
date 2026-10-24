import { isDeepStrictEqual } from "node:util";

type Item = Record<string, unknown> & { id: string; type: string };

export type ReplayRecord = {
	model: string;
	responseId: string;
	output: Item[];
	toolArguments: Record<string, unknown>;
};

/** Collect final provider items, not deltas or Pi's lossy assistant representation. */
export class ResponseOutput {
	private readonly items = new Map<number, Item>();
	private readonly ids = new Set<string>();
	private readonly indexes = new Map<number, string>();
	private readonly pending = new Set<number>();
	private ambiguous = false;
	private terminal = false;

	owns(id: string): boolean {
		return this.ids.has(id);
	}

	invalidate(): void {
		this.ambiguous = true;
	}

	observe(data: Record<string, unknown>): void {
		if (data.type === "response.output_item.added" || data.type === "response.output_item.done") {
			const item = asItem(data.item);
			const index = data.output_index;
			if (!item || typeof index !== "number" || !Number.isInteger(index) || index < 0) {
				this.invalidate();
				return;
			}
			const previous = this.indexes.get(index);
			if ((previous !== undefined && previous !== item.id) || (previous === undefined && this.ids.has(item.id))) {
				this.invalidate();
				return;
			}
			this.indexes.set(index, item.id);
			this.ids.add(item.id);
			if (data.type === "response.output_item.added") this.pending.add(index);
			else {
				this.items.set(index, structuredClone(item));
				this.pending.delete(index);
			}
			return;
		}
		if (!["response.completed", "response.incomplete", "response.failed"].includes(String(data.type))) return;
		this.terminal = true;
		const output = object(data.response)?.output;
		// ChatGPT can send output:[] after delivering all output_item.done events.
		// Only a nonempty, complete snapshot can replace the accumulated items.
		if (!Array.isArray(output) || output.length === 0) return;
		if (!output.every(asItem)) {
			this.invalidate();
			return;
		}
		this.items.clear();
		this.pending.clear();
		this.ids.clear();
		this.indexes.clear();
		this.ambiguous = false;
		for (const [index, item] of output.entries()) {
			this.items.set(index, structuredClone(item));
			this.ids.add(item.id);
			this.indexes.set(index, item.id);
		}
	}

	snapshot(): Item[] | undefined {
		if (!this.terminal || this.ambiguous || this.pending.size > 0 || this.items.size === 0) return;
		const sorted = [...this.items].sort(([a], [b]) => a - b);
		if (sorted.some(([index], position) => index !== position)) return;
		const output = sorted.map(([, item]) => item);
		if (new Set(output.map((item) => item.id)).size !== output.length) return;
		return structuredClone(output);
	}
}

export function readReplayRecord(value: unknown): ReplayRecord | undefined {
	const data = object(value);
	if (!data || typeof data.model !== "string" || typeof data.responseId !== "string" || !object(data.toolArguments) ||
		!Array.isArray(data.output) || data.output.length === 0 || !data.output.every(asItem)) return;
	if (new Set(data.output.map((item) => item.id)).size !== data.output.length) return;
	return data as ReplayRecord;
}

/** Replace only intact, same-model historical responses still present in this request. */
export function restoreInput(input: unknown[], records: ReplayRecord[], model: string): unknown[] {
	let result = input;
	for (const record of records) {
		if (record.model !== model) continue;
		const output = record.output;
		const anchors = output.filter((item) => ["reasoning", "message", "function_call", "custom_tool_call"].includes(item.type));
		// If Pi omitted the entire response there is no trustworthy request position.
		// Do not infer its presence from an earlier context hook or a matching user prefix.
		if (anchors.length === 0) continue;
		const positions = new Map<string, number[]>();
		for (const [index, value] of result.entries()) {
			const id = object(value)?.id;
			if (typeof id === "string") positions.set(id, [...(positions.get(id) ?? []), index]);
		}
		const firstRaw = positions.get(output[0].id);
		if (firstRaw?.length === 1 && isDeepStrictEqual(result.slice(firstRaw[0], firstRaw[0] + output.length), output)) continue;
		// Do not duplicate partially restored native items, or guess among duplicate IDs.
		if (output.some((item) => (positions.get(item.id)?.length ?? 0) > 1 ||
			(!anchors.includes(item) && positions.has(item.id)))) continue;
		const start = positions.get(anchors[0].id)?.[0];
		if (start === undefined || !anchors.every((item, offset) => matchesProjection(result[start + offset], item, record.toolArguments))) continue;
		result = [...result.slice(0, start), ...structuredClone(output), ...result.slice(start + anchors.length)];
	}
	return result;
}

/** Verify Pi's projection before replacing it, so context edits and other hooks win. */
function matchesProjection(value: unknown, original: Item, toolArguments: Record<string, unknown>): boolean {
	const item = object(value);
	if (!item || item.id !== original.id || item.type !== original.type) return false;
	if (isDeepStrictEqual(item, original)) return true;
	if (original.type === "reasoning") return false; // Opaque reasoning must match exactly.
	if (original.type === "message") {
		if (!Array.isArray(original.content)) return false;
		let text = "";
		for (const value of original.content) {
			const part = object(value);
			if (part?.type === "output_text" && typeof part.text === "string") text += part.text;
			else if (part?.type === "refusal" && typeof part.refusal === "string") text += part.refusal;
			else return false;
		}
		return equalJson(item, {
			type: "message", role: "assistant", id: original.id, status: "completed",
			phase: original.phase ?? undefined,
			content: [{ type: "output_text", text, annotations: [] }],
		});
	}
	if (original.type === "function_call") {
		try {
			if (typeof original.arguments !== "string" || typeof item.arguments !== "string") return false;
			if (!Object.hasOwn(toolArguments, original.id) || !isDeepStrictEqual(toolArguments[original.id], JSON.parse(item.arguments))) return false;
			return equalJson(item, {
				type: original.type, id: original.id, call_id: original.call_id, name: original.name,
				arguments: item.arguments, namespace: original.namespace,
			});
		} catch {
			return false;
		}
	}
	return equalJson(item, {
		type: "custom_tool_call", id: original.id, call_id: original.call_id, name: original.name,
		input: original.input, namespace: original.namespace,
	});
}

function equalJson(a: unknown, b: unknown): boolean {
	return isDeepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
}

function asItem(value: unknown): Item | undefined {
	const item = object(value);
	return item && typeof item.id === "string" && typeof item.type === "string" ? item as Item : undefined;
}

function object(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? value as Record<string, unknown> : undefined;
}
