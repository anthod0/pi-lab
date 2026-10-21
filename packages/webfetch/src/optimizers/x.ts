import { parseHTML } from "linkedom";
import type { ContentProcessResult } from "../content.js";
import type { FetchOptimizer, HtmlOptimizationInput } from "./types.js";

function isXHost(hostname: string): boolean {
	return hostname === "x.com" || hostname === "www.x.com" || hostname === "twitter.com" || hostname === "www.twitter.com";
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function extractStatusId(url: string): string | undefined {
	try {
		return new URL(url).pathname.match(/\/status(?:es)?\/(\d+)/)?.[1];
	} catch {
		return undefined;
	}
}

interface JsStringToken {
	value: string;
	end: number;
}

interface ObjectRange {
	start: number;
	end: number;
}

type DirectPropertyValue =
	| { type: "string"; value: string }
	| ({ type: "object" } & ObjectRange);

interface XDirectVideo {
	type: "video" | "gif";
	url: string;
	thumbnailUrl?: string;
	durationMillis?: number;
	width?: number;
	height?: number;
}

// Only the stream envelope is JavaScript. Read its strings and object boundaries
// without executing it; the response payload itself is parsed as JSON below.
function readJsString(source: string, start: number): JsStringToken | undefined {
	const quote = source[start];
	if (quote !== '"' && quote !== "'" && quote !== "`") return undefined;

	let value = "";
	for (let i = start + 1; i < source.length; i++) {
		const char = source[i];
		if (char === quote) return { value, end: i + 1 };
		if (char !== "\\") {
			value += char;
			continue;
		}

		const escaped = source[++i];
		if (escaped === undefined) return undefined;
		const simpleEscapes: Record<string, string> = {
			b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "0": "\0",
		};
		if (escaped in simpleEscapes) {
			value += simpleEscapes[escaped];
			continue;
		}
		if (escaped === "\n") continue;
		if (escaped === "\r") {
			if (source[i + 1] === "\n") i++;
			continue;
		}
		if (escaped === "x") {
			const hex = source.slice(i + 1, i + 3);
			if (!/^[0-9a-f]{2}$/i.test(hex)) return undefined;
			value += String.fromCodePoint(Number.parseInt(hex, 16));
			i += 2;
			continue;
		}
		if (escaped === "u") {
			if (source[i + 1] === "{") {
				const close = source.indexOf("}", i + 2);
				if (close === -1) return undefined;
				const hex = source.slice(i + 2, close);
				if (!/^[0-9a-f]{1,6}$/i.test(hex)) return undefined;
				const codePoint = Number.parseInt(hex, 16);
				if (codePoint > 0x10ffff) return undefined;
				value += String.fromCodePoint(codePoint);
				i = close;
				continue;
			}
			const hex = source.slice(i + 1, i + 5);
			if (!/^[0-9a-f]{4}$/i.test(hex)) return undefined;
			value += String.fromCharCode(Number.parseInt(hex, 16));
			i += 4;
			continue;
		}
		value += escaped;
	}
	return undefined;
}

function skipTrivia(source: string, start: number, limit = source.length): number {
	let i = start;
	while (i < limit) {
		if (/\s/.test(source[i] ?? "")) {
			i++;
			continue;
		}
		if (source.startsWith("//", i)) {
			const newline = source.indexOf("\n", i + 2);
			if (newline === -1 || newline >= limit) return limit;
			i = newline + 1;
			continue;
		}
		if (source.startsWith("/*", i)) {
			const close = source.indexOf("*/", i + 2);
			if (close === -1 || close + 2 > limit) return limit;
			i = close + 2;
			continue;
		}
		break;
	}
	return i;
}

function scanBalanced(source: string, start: number): ObjectRange | undefined {
	const pairs: Record<string, string> = { "{": "}", "[": "]", "(": ")" };
	const first = source[start];
	if (!first || !(first in pairs)) return undefined;
	const expected = [pairs[first]];

	for (let i = start + 1; i < source.length; i++) {
		const char = source[i];
		if (char === '"' || char === "'" || char === "`") {
			const token = readJsString(source, i);
			if (!token) return undefined;
			i = token.end - 1;
			continue;
		}
		if (source.startsWith("//", i) || source.startsWith("/*", i)) {
			const next = skipTrivia(source, i);
			if (next <= i || next >= source.length) return undefined;
			i = next - 1;
			continue;
		}
		if (char in pairs) {
			expected.push(pairs[char]);
			continue;
		}
		if (char === "}" || char === "]" || char === ")") {
			if (expected.pop() !== char) return undefined;
			if (expected.length === 0) return { start, end: i + 1 };
		}
	}
	return undefined;
}

function directProperty(source: string, range: ObjectRange, name: string): DirectPropertyValue | undefined {
	const closers: string[] = ["}"];
	const pairs: Record<string, string> = { "{": "}", "[": "]", "(": ")" };
	let i = range.start + 1;

	while (i < range.end - 1) {
		i = skipTrivia(source, i, range.end);
		const char = source[i];
		let key: string | undefined;
		if (char === '"' || char === "'" || char === "`") {
			const token = readJsString(source, i);
			if (!token) return undefined;
			if (closers.length === 1) key = token.value;
			i = token.end;
		} else if (char && /[A-Za-z_$]/.test(char)) {
			const match = source.slice(i, range.end).match(/^[A-Za-z_$][\w$]*/);
			if (!match) return undefined;
			if (closers.length === 1) key = match[0];
			i += match[0].length;
		} else {
			if (char && char in pairs) closers.push(pairs[char]);
			else if (char === "}" || char === "]" || char === ")") {
				if (closers.pop() !== char) return undefined;
			}
			i++;
			continue;
		}

		if (key !== name) continue;
		let valueStart = skipTrivia(source, i, range.end);
		if (source[valueStart] !== ":") continue;
		valueStart = skipTrivia(source, valueStart + 1, range.end);
		const valueChar = source[valueStart];
		if (valueChar === '"' || valueChar === "'" || valueChar === "`") {
			const token = readJsString(source, valueStart);
			if (!token || token.end >= range.end) return undefined;
			const next = source[skipTrivia(source, token.end, range.end)];
			return next === "," || next === "}" ? { type: "string", value: token.value } : undefined;
		}
		// Stream envelopes assign result objects into the serializer's reference table.
		const assignment = source.slice(valueStart, range.end).match(/^\$R\[\d+\]\s*=\s*/);
		if (assignment) valueStart += assignment[0].length;
		if (source[valueStart] !== "{") return undefined;
		const object = scanBalanced(source, valueStart);
		return object && object.end <= range.end ? { type: "object", ...object } : undefined;
	}
	return undefined;
}

function propertyString(source: string, range: ObjectRange, name: string): string | undefined {
	const property = directProperty(source, range, name);
	return property?.type === "string" ? property.value : undefined;
}

function findStreamEvents(source: string): ObjectRange[] {
	const ranges: ObjectRange[] = [];
	const delimiters: Array<{ char: string; start: number }> = [];
	const pairs: Record<string, string> = { "{": "}", "[": "]", "(": ")" };

	for (let i = 0; i < source.length; i++) {
		const char = source[i];
		if (char === '"' || char === "'" || char === "`") {
			const token = readJsString(source, i);
			if (!token) return ranges;
			if (token.value === "GraphQLRequestStream.Completed") {
				const parent = delimiters[delimiters.length - 1];
				if (parent?.char === "{") {
					const range = scanBalanced(source, parent.start);
					if (range && propertyString(source, range, "kind") === token.value) ranges.push(range);
				}
			}
			i = token.end - 1;
			continue;
		}
		if (source.startsWith("//", i) || source.startsWith("/*", i)) {
			const next = skipTrivia(source, i);
			if (next <= i || next >= source.length) break;
			i = next - 1;
			continue;
		}
		if (char && char in pairs) delimiters.push({ char, start: i });
		else if (char === "}" || char === "]" || char === ")") {
			const opening = delimiters.pop();
			if (!opening || pairs[opening.char] !== char) return ranges;
		}
	}
	return ranges;
}

function validVideoUrl(value: unknown): string | undefined {
	if (typeof value !== "string" || /[\u0000-\u0020\u007f]/.test(value)) return undefined;
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" || url.hostname !== "video.twimg.com") return undefined;
		if (!url.pathname.toLowerCase().endsWith(".mp4") || url.pathname.toLowerCase().includes("hevc")) return undefined;
		return value;
	} catch {
		return undefined;
	}
}

function validThumbnailUrl(value: unknown): string | undefined {
	if (typeof value !== "string" || /[\u0000-\u0020\u007f]/.test(value)) return undefined;
	try {
		const url = new URL(value);
		return url.protocol === "https:" && url.hostname === "pbs.twimg.com" ? value : undefined;
	} catch {
		return undefined;
	}
}

function tweetVideo(tweet: Record<string, unknown>): XDirectVideo | undefined {
	if (!Array.isArray(tweet.media_entities2)) return undefined;
	for (const media of tweet.media_entities2) {
		if (!isObject(media) || (media.type !== "video" && media.type !== "animated_gif")) continue;
		const info = media.video_info;
		if (!isObject(info) || !Array.isArray(info.variants)) continue;
		let best: { url: string; bitrate: number } | undefined;
		for (const variant of info.variants) {
			if (!isObject(variant) || variant.content_type !== "video/mp4") continue;
			const url = validVideoUrl(variant.url);
			if (!url) continue;
			const bitrate = numberValue(variant.bitrate) ?? 0;
			if (!best || bitrate > best.bitrate) best = { url, bitrate };
		}
		if (!best) continue;
		const original = isObject(media.original_info) ? media.original_info : undefined;
		return {
			type: media.type === "animated_gif" ? "gif" : "video",
			url: best.url,
			thumbnailUrl: validThumbnailUrl(media.media_url_https),
			durationMillis: numberValue(info.duration_millis),
			width: numberValue(original?.width),
			height: numberValue(original?.height),
		};
	}
	return undefined;
}

function findFocalVideo(data: unknown, statusId: string): XDirectVideo | undefined {
	const pending = [data];
	while (pending.length > 0) {
		const value = pending.pop();
		if (Array.isArray(value)) {
			for (let i = value.length - 1; i >= 0; i--) pending.push(value[i]);
		} else if (isObject(value)) {
			if (value.rest_id === statusId) {
				const media = tweetVideo(value);
				if (media) return media;
			}
			const children = Object.values(value);
			for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]);
		}
	}
	return undefined;
}

function extractXVideo(html: string, statusId: string): XDirectVideo | undefined {
	const { document } = parseHTML(html);
	for (const element of document.querySelectorAll("script:not([src])")) {
		const script = element.textContent ?? "";
		if (!script.includes("GraphQLRequestStream.Completed")) continue;
		for (const event of findStreamEvents(script)) {
			const result = directProperty(script, event, "result");
			if (result?.type !== "object" || propertyString(script, result, "kind") !== "Result.Ok") continue;
			const payload = propertyString(script, result, "value");
			if (!payload) continue;
			let response: unknown;
			try {
				response = JSON.parse(payload);
			} catch {
				continue;
			}
			if (!isObject(response)) continue;
			const media = findFocalVideo(response.data, statusId);
			if (media) return media;
		}
	}
	return undefined;
}

function renderDirectMedia(media: XDirectVideo): string {
	const label = media.type === "gif" ? "GIF" : "Video";
	const lines = ["## Direct media", "", `- ${label} (MP4): ${media.url}`];
	if (media.thumbnailUrl) lines.push(`- Thumbnail: ${media.thumbnailUrl}`);
	if (media.durationMillis !== undefined) lines.push(`- Duration: ${media.durationMillis / 1000} seconds`);
	if (media.width !== undefined && media.height !== undefined) lines.push(`- Dimensions: ${media.width}×${media.height}`);
	return lines.join("\n");
}

async function optimizeXHtml({ url, html, defaultProcess }: HtmlOptimizationInput): Promise<ContentProcessResult | undefined> {
	const statusId = extractStatusId(url);
	if (!statusId) return undefined;
	let media: XDirectVideo | undefined;
	try {
		media = extractXVideo(html, statusId);
	} catch {
		return undefined;
	}
	if (!media) return undefined;
	const result = await defaultProcess();
	if (result.markdown.includes(media.url)) return result;
	return { ...result, markdown: `${result.markdown.trimEnd()}\n\n${renderDirectMedia(media)}` };
}

export const xOptimizer: FetchOptimizer = {
	id: "x",
	match(url) {
		try {
			return isXHost(new URL(url).hostname.toLowerCase());
		} catch {
			return false;
		}
	},
	async processHtml(input) {
		return optimizeXHtml(input);
	},
};
