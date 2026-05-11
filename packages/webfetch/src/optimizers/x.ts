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

function mediaUrls(tweet: Record<string, unknown>): string[] {
	const extended = isObject(tweet.extended_entities) ? tweet.extended_entities : undefined;
	const entities = isObject(tweet.entities) ? tweet.entities : undefined;
	const media = Array.isArray(extended?.media) ? extended.media : Array.isArray(entities?.media) ? entities.media : [];
	const urls = new Set<string>();
	for (const item of media) {
		if (!isObject(item)) continue;
		const url = stringValue(item.media_url_https) ?? stringValue(item.media_url);
		if (url) urls.add(url);
	}
	return [...urls];
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
	const media = mediaUrls(tweet);

	let body = decodeHtmlEntities(text).replace(/\s+https:\/\/t\.co\/\S+\s*$/g, "").trim();
	if (!body) return undefined;

	const lines: string[] = [];
	lines.push(screenName ? `# Tweet by ${name} (@${screenName})` : `# Tweet by ${name}`);
	if (createdAt) lines.push("", `Posted: ${createdAt}`);
	if (stats) lines.push(stats);
	lines.push("", body);
	if (media.length > 0) {
		lines.push("", "Media:", ...media.map((url) => `- ${url}`));
	}
	return lines.join("\n");
}

function optimizeXHtml({ url, html }: HtmlOptimizationInput): ContentProcessResult | undefined {
	const state = parseInitialState(html);
	const tweets = entitiesMap(state?.entities?.tweets);
	const users = entitiesMap(state?.entities?.users);
	const tweet = selectTweet(tweets, url);
	if (!tweet) return undefined;

	const markdown = renderTweetMarkdown(tweet, users);
	if (!markdown) return undefined;

	return {
		markdown,
		scripts: [],
		method: "optimized",
	};
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
