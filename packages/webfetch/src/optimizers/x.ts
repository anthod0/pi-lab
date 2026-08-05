import { parseHTML } from "linkedom";
import type { ContentProcessResult } from "../content.js";
import type { FetchOptimizer, HtmlOptimizationInput } from "./types.js";

function isXHost(hostname: string): boolean {
	return hostname === "x.com" || hostname === "www.x.com" || hostname === "twitter.com" || hostname === "www.twitter.com";
}

interface XInitialState {
	entities?: {
		tweets?: { entities?: Record<string, unknown> } | Record<string, unknown>;
		users?: { entities?: Record<string, unknown> } | Record<string, unknown>;
	};
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function entitiesMap(value: unknown): Record<string, unknown> {
	if (!isObject(value)) return {};
	const nested = value.entities;
	return isObject(nested) ? nested : value;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
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
	| { type: "number"; value: number }
	| ({ type: "object" } & ObjectRange);

interface XDirectVideo {
	type: "video" | "gif";
	url: string;
	thumbnailUrl?: string;
	durationMillis?: number;
	width?: number;
	height?: number;
	source: "json-ld";
}

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
			b: "\b",
			f: "\f",
			n: "\n",
			r: "\r",
			t: "\t",
			v: "\v",
			"0": "\0",
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
			return newline === -1 || newline >= limit ? limit : skipTrivia(source, newline + 1, limit);
		}
		if (source.startsWith("/*", i)) {
			const close = source.indexOf("*/", i + 2);
			return close === -1 || close + 2 > limit ? limit : skipTrivia(source, close + 2, limit);
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

function assignedObject(source: string, start: number, limit: number): ObjectRange | undefined {
	const pairs: Record<string, string> = { "[": "]", "(": ")" };
	const expected: string[] = [];
	for (let i = start; i < limit; i++) {
		const char = source[i];
		if (char === '"' || char === "'" || char === "`") {
			const token = readJsString(source, i);
			if (!token) return undefined;
			i = token.end - 1;
			continue;
		}
		if (source.startsWith("//", i) || source.startsWith("/*", i)) {
			const next = skipTrivia(source, i, limit);
			if (next <= i || next >= limit) return undefined;
			i = next - 1;
			continue;
		}
		if (char === "{" && expected.length === 0) return scanBalanced(source, i);
		if (char in pairs) expected.push(pairs[char]);
		else if (char === "]" || char === ")") {
			if (expected.pop() !== char) return undefined;
		} else if (char === "," && expected.length === 0) {
			return undefined;
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
		let keyEnd = i;
		if (char === '"' || char === "'" || char === "`") {
			const token = readJsString(source, i);
			if (!token) return undefined;
			if (closers.length === 1) key = token.value;
			keyEnd = token.end;
			i = token.end;
		} else if (char && /[A-Za-z_$]/.test(char)) {
			const match = source.slice(i, range.end).match(/^[A-Za-z_$][\w$]*/);
			if (!match) return undefined;
			if (closers.length === 1) key = match[0];
			keyEnd = i + match[0].length;
			i = keyEnd;
		} else {
			if (char && char in pairs) closers.push(pairs[char]);
			else if (char === "}" || char === "]" || char === ")") {
				if (closers.pop() !== char) return undefined;
			}
			i++;
			continue;
		}

		if (key !== name) continue;
		let valueStart = skipTrivia(source, keyEnd, range.end);
		if (source[valueStart] !== ":") continue;
		valueStart = skipTrivia(source, valueStart + 1, range.end);
		const valueChar = source[valueStart];
		if (valueChar === '"' || valueChar === "'" || valueChar === "`") {
			const token = readJsString(source, valueStart);
			return token ? { type: "string", value: token.value } : undefined;
		}
		if (valueChar === "{") {
			const object = scanBalanced(source, valueStart);
			return object && object.end <= range.end ? { type: "object", ...object } : undefined;
		}
		const assigned = assignedObject(source, valueStart, range.end);
		if (assigned && assigned.end <= range.end) return { type: "object", ...assigned };
		const numberMatch = source.slice(valueStart, range.end).match(/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i);
		if (numberMatch) {
			const value = Number(numberMatch[0]);
			return Number.isFinite(value) ? { type: "number", value } : undefined;
		}
		return undefined;
	}
	return undefined;
}

function findSocialPostingRanges(script: string): ObjectRange[] {
	const ranges: ObjectRange[] = [];
	const seen = new Set<number>();
	const delimiters: Array<{ char: string; start: number }> = [];
	const pairs: Record<string, string> = { "{": "}", "[": "]", "(": ")" };

	for (let i = 0; i < script.length; i++) {
		const char = script[i];
		if (char === '"' || char === "'" || char === "`") {
			const token = readJsString(script, i);
			if (!token) return ranges;
			if (token.value === "SocialMediaPosting") {
				let object: { char: string; start: number } | undefined;
				for (let j = delimiters.length - 1; j >= 0; j--) {
					if (delimiters[j]?.char === "{") {
						object = delimiters[j];
						break;
					}
				}
				if (object && !seen.has(object.start)) {
					const range = scanBalanced(script, object.start);
					if (range) {
						seen.add(object.start);
						ranges.push(range);
					}
				}
			}
			i = token.end - 1;
			continue;
		}
		if (script.startsWith("//", i) || script.startsWith("/*", i)) {
			const next = skipTrivia(script, i);
			if (next <= i || next >= script.length) break;
			i = next - 1;
			continue;
		}
		if (char in pairs) delimiters.push({ char, start: i });
		else if (char === "}" || char === "]" || char === ")") {
			const opening = delimiters.pop();
			if (!opening || pairs[opening.char] !== char) return ranges;
		}
	}
	return ranges;
}

function propertyString(source: string, range: ObjectRange, name: string): string | undefined {
	const property = directProperty(source, range, name);
	return property?.type === "string" ? property.value : undefined;
}

function propertyNumber(source: string, range: ObjectRange, name: string): number | undefined {
	const property = directProperty(source, range, name);
	return property?.type === "number" ? property.value : undefined;
}

function postingMatchesStatus(script: string, range: ObjectRange, statusId: string): boolean {
	if (propertyString(script, range, "identifier") === statusId) return true;
	const id = propertyString(script, range, "@id");
	if (!id) return false;
	try {
		return new URL(id).pathname.match(/\/status(?:es)?\/(\d+)/)?.[1] === statusId;
	} catch {
		return false;
	}
}

function validVideoUrl(value: string): string | undefined {
	if (/[\u0000-\u0020\u007f]/.test(value)) return undefined;
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" || url.hostname !== "video.twimg.com") return undefined;
		if (!url.pathname.toLowerCase().endsWith(".mp4") || url.pathname.toLowerCase().includes("hevc")) return undefined;
		return value;
	} catch {
		return undefined;
	}
}

function validThumbnailUrl(value: string | undefined): string | undefined {
	if (!value || /[\u0000-\u0020\u007f]/.test(value)) return undefined;
	try {
		const url = new URL(value);
		return url.protocol === "https:" && url.hostname === "pbs.twimg.com" ? value : undefined;
	} catch {
		return undefined;
	}
}

function parseDurationMillis(duration: string | undefined): number | undefined {
	if (!duration) return undefined;
	const match = duration.match(/^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
	if (!match || !match.slice(1).some(Boolean)) return undefined;
	const millis = ((Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)) * 60 + Number(match[3] ?? 0)) * 1000;
	return Number.isFinite(millis) && millis >= 0 ? Math.round(millis) : undefined;
}

function extractXDirectVideo(html: string, statusId: string): XDirectVideo | undefined {
	const { document } = parseHTML(html);
	for (const element of document.querySelectorAll("script:not([src])")) {
		const script = element.textContent ?? "";
		if (!script.includes(statusId) || !script.includes("video.twimg.com")) continue;
		for (const posting of findSocialPostingRanges(script)) {
			if (propertyString(script, posting, "@type") !== "SocialMediaPosting") continue;
			if (!postingMatchesStatus(script, posting, statusId)) continue;
			const video = directProperty(script, posting, "video");
			if (video?.type !== "object" || propertyString(script, video, "@type") !== "VideoObject") continue;
			const url = validVideoUrl(propertyString(script, video, "contentUrl") ?? "");
			if (!url) continue;
			return {
				type: new URL(url).pathname.includes("/tweet_video/") ? "gif" : "video",
				url,
				thumbnailUrl: validThumbnailUrl(propertyString(script, video, "thumbnailUrl")),
				durationMillis: parseDurationMillis(propertyString(script, video, "duration")),
				width: propertyNumber(script, video, "width"),
				height: propertyNumber(script, video, "height"),
				source: "json-ld",
			};
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

function enrichXMarkdown(result: ContentProcessResult, media: XDirectVideo): ContentProcessResult {
	if (result.markdown.includes(media.url)) return result;
	return { ...result, markdown: `${result.markdown.trimEnd()}\n\n${renderDirectMedia(media)}` };
}

function extractInitialStateJson(script: string): string | undefined {
	const marker = "window.__INITIAL_STATE__=";
	const start = script.indexOf(marker);
	if (start === -1) return undefined;

	const jsonStart = script.indexOf("{", start + marker.length);
	if (jsonStart === -1) return undefined;

	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = jsonStart; i < script.length; i++) {
		const char = script[i];
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}

		if (char === '"') {
			inString = true;
		} else if (char === "{") {
			depth++;
		} else if (char === "}") {
			depth--;
			if (depth === 0) return script.slice(jsonStart, i + 1);
		}
	}

	return undefined;
}

function parseInitialState(html: string): XInitialState | undefined {
	const { document } = parseHTML(html);
	for (const script of document.querySelectorAll("script:not([src])")) {
		const json = extractInitialStateJson(script.textContent ?? "");
		if (!json) continue;
		try {
			const parsed = JSON.parse(json) as unknown;
			return isObject(parsed) ? parsed : undefined;
		} catch {
			return undefined;
		}
	}
	return undefined;
}

function decodeHtmlEntities(text: string): string {
	let result = text;
	for (let i = 0; i < 3; i++) {
		const decoded = result
			.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
			.replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&amp;/g, "&");
		if (decoded === result) break;
		result = decoded;
	}
	return result;
}

interface MarkdownMediaItem {
	type: "photo" | "video" | "gif";
	url: string;
	thumbnailUrl?: string;
}

function tweetMedia(tweet: Record<string, unknown>): unknown[] {
	const extended = isObject(tweet.extended_entities) ? tweet.extended_entities : undefined;
	const entities = isObject(tweet.entities) ? tweet.entities : undefined;
	return Array.isArray(extended?.media) ? extended.media : Array.isArray(entities?.media) ? entities.media : [];
}

function bestMp4Variant(media: Record<string, unknown>): string | undefined {
	const videoInfo = isObject(media.video_info) ? media.video_info : undefined;
	const variants = Array.isArray(videoInfo?.variants) ? videoInfo.variants : [];
	let best: { url: string; bitrate: number } | undefined;

	for (const variant of variants) {
		if (!isObject(variant)) continue;
		const url = stringValue(variant.url);
		if (!url) continue;
		const contentType = stringValue(variant.content_type) ?? "";
		const isMp4 = contentType.includes("mp4") || url.includes(".mp4");
		if (!isMp4 || url.includes("hevc")) continue;
		const bitrate = numberValue(variant.bitrate) ?? 0;
		if (!best || bitrate > best.bitrate) best = { url, bitrate };
	}

	return best?.url;
}

function markdownMedia(tweet: Record<string, unknown>): MarkdownMediaItem[] {
	const items: MarkdownMediaItem[] = [];
	const seen = new Set<string>();
	for (const item of tweetMedia(tweet)) {
		if (!isObject(item)) continue;
		const mediaType = stringValue(item.type);
		const thumbnailUrl = stringValue(item.media_url_https) ?? stringValue(item.media_url);
		if (mediaType === "video" || mediaType === "animated_gif") {
			const url = bestMp4Variant(item);
			if (url && !seen.has(url)) {
				seen.add(url);
				items.push({
					type: mediaType === "animated_gif" ? "gif" : "video",
					url,
					thumbnailUrl,
				});
			}
			continue;
		}

		if (thumbnailUrl && !seen.has(thumbnailUrl)) {
			seen.add(thumbnailUrl);
			items.push({ type: "photo", url: thumbnailUrl });
		}
	}
	return items;
}

function formatStats(tweet: Record<string, unknown>): string | undefined {
	const stats = [
		["Replies", numberValue(tweet.reply_count)],
		["Retweets", numberValue(tweet.retweet_count)],
		["Quotes", numberValue(tweet.quote_count)],
		["Likes", numberValue(tweet.favorite_count)],
	].filter((entry): entry is [string, number] => entry[1] !== undefined);
	if (stats.length === 0) return undefined;
	return stats.map(([label, value]) => `${label}: ${value}`).join(" · ");
}

function selectTweet(tweets: Record<string, unknown>, url: string): Record<string, unknown> | undefined {
	const statusId = extractStatusId(url);
	if (statusId && isObject(tweets[statusId])) return tweets[statusId];
	return Object.values(tweets).find(isObject);
}

function renderTweetMarkdown(tweet: Record<string, unknown>, users: Record<string, unknown>): string | undefined {
	const text = stringValue(tweet.full_text) ?? stringValue(tweet.text);
	if (!text) return undefined;

	const userId = stringValue(tweet.user);
	const user = userId ? users[userId] : undefined;
	const userObj = isObject(user) ? user : undefined;
	const name = stringValue(userObj?.name) ?? "Unknown author";
	const screenName = stringValue(userObj?.screen_name);
	const createdAt = stringValue(tweet.created_at);
	const stats = formatStats(tweet);
	const media = markdownMedia(tweet);

	let body = decodeHtmlEntities(text).replace(/\s+https:\/\/t\.co\/\S+\s*$/g, "").trim();
	if (!body) return undefined;

	const lines: string[] = [];
	lines.push(screenName ? `# Tweet by ${name} (@${screenName})` : `# Tweet by ${name}`);
	if (createdAt) lines.push("", `Posted: ${createdAt}`);
	if (stats) lines.push(stats);
	lines.push("", body);
	if (media.length > 0) {
		lines.push("", "Media:");
		for (const item of media) {
			if (item.type === "video") {
				lines.push(`- Video: ${item.url}`);
				if (item.thumbnailUrl) lines.push(`  Thumbnail: ${item.thumbnailUrl}`);
			} else if (item.type === "gif") {
				lines.push(`- GIF: ${item.url}`);
				if (item.thumbnailUrl) lines.push(`  Thumbnail: ${item.thumbnailUrl}`);
			} else {
				lines.push(`- ${item.url}`);
			}
		}
	}
	return lines.join("\n");
}

async function optimizeXHtml({ url, html, defaultProcess }: HtmlOptimizationInput): Promise<ContentProcessResult | undefined> {
	const state = parseInitialState(html);
	const tweets = entitiesMap(state?.entities?.tweets);
	const users = entitiesMap(state?.entities?.users);
	const tweet = selectTweet(tweets, url);
	if (tweet) {
		const markdown = renderTweetMarkdown(tweet, users);
		if (markdown) {
			return {
				markdown,
				scripts: [],
				method: "optimized",
			};
		}
	}

	const statusId = extractStatusId(url);
	if (!statusId) return undefined;
	try {
		const media = extractXDirectVideo(html, statusId);
		if (!media) return undefined;
		return enrichXMarkdown(await defaultProcess(), media);
	} catch {
		return undefined;
	}
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
