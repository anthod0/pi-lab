type Citation = { url: string; title: string; start?: number; end?: number };

const citationMarker = /^cite[^]*$/u;

/** Only data observed through Pi's public provider-stream hook is retained. */
export class SearchResponse {
	private readonly sources = new Map<string, Citation>();
	private readonly texts = new Map<string, string | null>();

	observe(data: Record<string, unknown>): void {
		if (data.type === "response.output_text.annotation.added") {
			this.addCitation(data.annotation);
		} else if (data.type === "response.output_item.done") {
			this.addMessage(data.item);
		} else if (data.type === "response.completed" || data.type === "response.incomplete" || data.type === "response.failed") {
			const response = object(data.response);
			if (Array.isArray(response?.output)) {
				for (const item of response.output) this.addMessage(item);
			}
		}
	}

	formatText(text: string): string {
		return this.texts.get(text) ?? text;
	}

	formatSources(): string {
		if (this.sources.size === 0) return "";
		return `\n\nSources:\n${[...this.sources.values()].map((source) => `- ${link(source)}`).join("\n")}`;
	}

	private addCitation(value: unknown): Citation | undefined {
		const raw = object(value);
		if (raw?.type !== "url_citation" || typeof raw.url !== "string") return;
		let url: URL;
		try {
			url = new URL(raw.url);
		} catch {
			return;
		}
		if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return;
		const citation: Citation = {
			url: url.href.replaceAll("\\", "%5C").replaceAll("<", "%3C").replaceAll(">", "%3E"),
			title: typeof raw.title === "string" && raw.title.trim() ? raw.title : url.hostname,
			start: typeof raw.start_index === "number" ? raw.start_index : undefined,
			end: typeof raw.end_index === "number" ? raw.end_index : undefined,
		};
		this.sources.set(citation.url, citation);
		return citation;
	}

	private addMessage(value: unknown): void {
		const item = object(value);
		if (item?.type !== "message" || !Array.isArray(item.content)) return;
		let original = "";
		let formatted = "";
		for (const value of item.content) {
			const part = object(value);
			if (part?.type === "refusal" && typeof part.refusal === "string") {
				original += part.refusal;
				formatted += part.refusal;
			} else if (part?.type === "output_text" && typeof part.text === "string") {
				original += part.text;
				const citations = Array.isArray(part.annotations)
					? part.annotations.flatMap((raw) => {
						const citation = this.addCitation(raw);
						return citation ? [citation] : [];
					})
					: [];
				formatted += replaceMarkers(part.text, citations);
			}
		}
		if (!original) return;
		// Identical text with different annotations is ambiguous; keep the text and source list.
		if (this.texts.has(original) && this.texts.get(original) !== formatted) this.texts.set(original, null);
		else this.texts.set(original, formatted);
	}
}

function replaceMarkers(text: string, citations: Citation[]): string {
	const replacements = new Map<string, { start: number; end: number; links: Set<string> }>();
	for (const citation of citations) {
		const { start, end } = citation;
		if (start === undefined || end === undefined || !Number.isInteger(start) || !Number.isInteger(end)) continue;
		if (start < 0 || end <= start || end > text.length || !citationMarker.test(text.slice(start, end))) continue;
		const key = `${start}:${end}`;
		const replacement = replacements.get(key) ?? { start, end, links: new Set<string>() };
		replacement.links.add(link(citation));
		replacements.set(key, replacement);
	}
	let boundary = text.length;
	for (const replacement of [...replacements.values()].sort((a, b) => b.start - a.start)) {
		if (replacement.end > boundary) continue;
		text = text.slice(0, replacement.start) + [...replacement.links].join(" ") + text.slice(replacement.end);
		boundary = replacement.start;
	}
	return text;
}

function link(citation: Citation): string {
	const title = citation.title
		.replace(/[\p{Cc}\p{Cf}]/gu, " ")
		.replace(/[\\`*_[\]<>]/g, "\\$&");
	return `[${title}](<${citation.url}>)`;
}

function object(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}
