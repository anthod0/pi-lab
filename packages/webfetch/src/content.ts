import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

let turndownInstance: TurndownService | null = null;

function getTurndown(): TurndownService {
	if (!turndownInstance) {
		turndownInstance = new TurndownService({
			headingStyle: "atx",
			codeBlockStyle: "fenced",
			bulletListMarker: "-",
		});

		// Strip style tags (no informational value) and script/noscript content
		// from the Markdown body. Inline scripts are preserved separately in the
		// script index and accessible via the `script=N` parameter.
		turndownInstance.remove(["style", "script", "noscript"] as (keyof HTMLElementTagNameMap)[]);

		// Keep code blocks intact
		turndownInstance.keep(["pre", "code"]);
	}
	return turndownInstance;
}

export interface InlineScript {
	index: number;
	length: number;
	preview: string; // first 80 chars, whitespace-collapsed
	content: string;
}

export interface ContentProcessResult {
	markdown: string;
	scripts: InlineScript[];
	method: "readability" | "full-html" | "plain" | "optimized";
}

/**
 * Extract inline <script> elements (no src attribute) from a parsed document.
 * External scripts are skipped — they have no inline content.
 */
function extractInlineScripts(
	document: ReturnType<typeof parseHTML>["document"],
): InlineScript[] {
	const results: InlineScript[] = [];
	const els = document.querySelectorAll("script:not([src])");
	let index = 0;
	for (const el of els) {
		const content = el.textContent?.trim() ?? "";
		if (content.length === 0) continue;
		results.push({
			index: index++,
			length: content.length,
			preview: content.slice(0, 80).replace(/\s+/g, " "),
			content,
		});
	}
	return results;
}

/**
 * Process HTML content:
 * 1. Try Mozilla Readability to extract main content
 * 2. If extraction ratio < 10%, fall back to full HTML → Markdown
 * Also extracts inline scripts as a separate list.
 */
export async function processHtml(html: string, _url: string): Promise<ContentProcessResult> {
	const td = getTurndown();

	const { document } = parseHTML(html);

	// Extract inline scripts before Readability mutates the DOM
	const scripts = extractInlineScripts(document);

	// Attempt Readability extraction
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const reader = new Readability(document as any);
		const article = reader.parse();

		if (article?.content) {
			const ratio = article.content.length / html.length;

			// Accept if extraction is meaningful (>= 10% of source)
			if (ratio >= 0.1) {
				return {
					markdown: td.turndown(article.content),
					scripts,
					method: "readability",
				};
			}
		}
	} catch {
		// Fall through to full HTML conversion
	}

	// Fallback: convert full HTML to Markdown
	return {
		markdown: td.turndown(html),
		scripts,
		method: "full-html",
	};
}

/**
 * Process plain text / markdown content.
 */
export function processPlainText(text: string): string {
	return text;
}
