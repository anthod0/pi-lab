import { DOMParser, parseHTML } from "linkedom";
import { htmlToMarkdown } from "../content.js";
import type { FetchOptimizer, OptimizedFetchResult } from "./types.js";

const REDDIT_RSS_CACHE_TTL_MS = 60 * 60 * 1000;
const REDDIT_FALLBACK_CACHE_TTL_MS = 60 * 1000;
const USER_AGENT = "Mozilla/5.0 (compatible; pi-webfetch/1.0)";

export interface RedditPostUrl {
	postId: string;
	subreddit: string;
	slug?: string;
	permalink: string;
	cacheKey: string;
	rssUrl: string;
	embedUrl: string;
	oembedUrl: string;
}

interface RedditEntry {
	id: string;
	title: string;
	author?: string;
	bodyMarkdown: string;
	permalink: string;
	updated?: string;
	media: RedditMedia[];
}

interface RedditMedia {
	url: string;
	alt?: string;
}

interface RedditRssData {
	post: RedditEntry;
	comments: RedditEntry[];
}

interface RedditEmbedData {
	title?: string;
	author?: string;
	displayedCommentCount?: number;
	media: RedditMedia[];
}

interface RedditOEmbedData {
	title?: string;
	author?: string;
}

interface FetchAttempt {
	ok: boolean;
	status: number;
	statusText: string;
	body: string;
	retryAfter?: string;
	rateLimitReset?: string;
}

function cleanText(value: string | null | undefined): string | undefined {
	const text = value?.trim();
	return text || undefined;
}

function cleanAuthor(value: string | undefined): string | undefined {
	return value?.replace(/^\/u\//, "u/");
}

export function parseRedditPostUrl(rawUrl: string): RedditPostUrl | undefined {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return undefined;
	}

	const hostname = url.hostname.toLowerCase();
	if (hostname !== "reddit.com" && hostname !== "www.reddit.com") return undefined;

	const parts = url.pathname.split("/").filter(Boolean);
	if (parts.length < 4 || parts[0]?.toLowerCase() !== "r" || parts[2]?.toLowerCase() !== "comments") {
		return undefined;
	}

	const subreddit = parts[1];
	const postId = parts[3]?.toLowerCase();
	if (!subreddit || !postId || !/^[a-z0-9]+$/.test(postId)) return undefined;

	const possibleSlug = parts[4];
	const slug = possibleSlug && possibleSlug !== ".rss" ? possibleSlug : undefined;
	const rootPath = `/r/${encodeURIComponent(subreddit)}/comments/${postId}/${slug ? `${encodeURIComponent(slug)}/` : ""}`;
	const permalink = `https://www.reddit.com${rootPath}`;
	const rssUrl = new URL(".rss", permalink);
	rssUrl.searchParams.set("limit", "500");
	rssUrl.searchParams.set("sort", "top");

	const embedUrl = new URL(rootPath, "https://embed.reddit.com");
	embedUrl.searchParams.set("ref_source", "embed");
	embedUrl.searchParams.set("ref", "share");
	embedUrl.searchParams.set("embed", "true");

	const oembedUrl = new URL("https://www.reddit.com/oembed");
	oembedUrl.searchParams.set("url", permalink);

	return {
		postId,
		subreddit,
		slug,
		permalink,
		cacheKey: `reddit:post:${postId}`,
		rssUrl: rssUrl.toString(),
		embedUrl: embedUrl.toString(),
		oembedUrl: oembedUrl.toString(),
	};
}

function mediaFromHtml(html: string): RedditMedia[] {
	const { document } = parseHTML(`<main>${html}</main>`);
	const media: RedditMedia[] = [];
	const seen = new Set<string>();
	for (const image of document.querySelectorAll("img")) {
		const url = cleanText(image.getAttribute("src"));
		if (!url || seen.has(url)) continue;
		seen.add(url);
		media.push({ url, alt: cleanText(image.getAttribute("alt")) });
	}
	return media;
}

function entryBodyMarkdown(contentHtml: string): string {
	const { document } = parseHTML(`<main>${contentHtml}</main>`);
	const body = document.querySelector(".md");
	return htmlToMarkdown(body?.innerHTML ?? contentHtml);
}

export function parseRedditAtom(xml: string): RedditRssData | undefined {
	const document = new DOMParser().parseFromString(xml, "text/xml");
	const entries: RedditEntry[] = [];

	for (const element of document.querySelectorAll("entry")) {
		const id = cleanText(element.querySelector("id")?.textContent);
		if (!id || (!id.startsWith("t3_") && !id.startsWith("t1_"))) continue;

		const contentHtml = element.querySelector("content")?.textContent ?? "";
		const permalink = cleanText(element.querySelector("link")?.getAttribute("href")) ?? "";
		entries.push({
			id,
			title: cleanText(element.querySelector("title")?.textContent) ?? "Untitled",
			author: cleanAuthor(cleanText(element.querySelector("author name")?.textContent)),
			bodyMarkdown: entryBodyMarkdown(contentHtml),
			permalink,
			updated: cleanText(element.querySelector("updated")?.textContent),
			media: mediaFromHtml(contentHtml),
		});
	}

	const post = entries.find((entry) => entry.id.startsWith("t3_"));
	if (!post) return undefined;
	return {
		post,
		comments: entries.filter((entry) => entry.id.startsWith("t1_")),
	};
}

function preferredImageUrl(image: Element): string | undefined {
	const srcset = image.getAttribute("srcset");
	if (srcset) {
		const candidates = srcset.split(",").map((candidate) => {
			const [url, width] = candidate.trim().split(/\s+/, 2);
			return { url, width: Number.parseInt(width ?? "0", 10) || 0 };
		}).filter((candidate) => candidate.url);
		candidates.sort((a, b) => b.width - a.width);
		if (candidates[0]?.url) return candidates[0].url;
	}
	return cleanText(image.getAttribute("src"));
}

export function parseRedditEmbed(html: string): RedditEmbedData | undefined {
	const { document } = parseHTML(html);
	const title = cleanText(document.querySelector("#embed-title")?.textContent);
	const authorLink = document.querySelector('a[href*="/user/"]');
	const author = cleanAuthor(cleanText(authorLink?.textContent));
	const countText = cleanText(document.querySelector('[data-testid="cta"]')?.textContent);
	const countMatch = countText?.replaceAll(",", "").match(/(\d+)\s+comments?/i);
	const displayedCommentCount = countMatch ? Number.parseInt(countMatch[1], 10) : undefined;

	const media: RedditMedia[] = [];
	const seen = new Set<string>();
	for (const image of document.querySelectorAll("img")) {
		const url = preferredImageUrl(image);
		if (!url || seen.has(url)) continue;
		let hostname: string;
		try {
			hostname = new URL(url).hostname.toLowerCase();
		} catch {
			continue;
		}
		if (hostname !== "preview.redd.it" && hostname !== "i.redd.it" && hostname !== "external-preview.redd.it") continue;
		seen.add(url);
		media.push({ url, alt: cleanText(image.getAttribute("alt")) });
	}

	if (!title && !author && media.length === 0 && displayedCommentCount === undefined) return undefined;
	return { title, author, displayedCommentCount, media };
}

function parseOEmbed(json: string): RedditOEmbedData | undefined {
	try {
		const value = JSON.parse(json) as Record<string, unknown>;
		const title = typeof value.title === "string" ? cleanText(value.title) : undefined;
		const author = typeof value.author_name === "string" ? cleanAuthor(cleanText(value.author_name)) : undefined;
		return title || author ? { title, author } : undefined;
	} catch {
		return undefined;
	}
}

async function fetchText(url: string, signal: AbortSignal | undefined, fetcher: typeof fetch): Promise<FetchAttempt> {
	try {
		const response = await fetcher(url, {
			signal,
			headers: {
				Accept: "application/atom+xml, application/xml, application/json, text/html;q=0.9, */*;q=0.1",
				"User-Agent": USER_AGENT,
			},
		});
		return {
			ok: response.ok,
			status: response.status,
			statusText: response.statusText,
			body: await response.text(),
			retryAfter: response.headers.get("retry-after") ?? undefined,
			rateLimitReset: response.headers.get("x-ratelimit-reset") ?? undefined,
		};
	} catch (error) {
		if (signal?.aborted) throw error;
		return {
			ok: false,
			status: 0,
			statusText: error instanceof Error ? error.message : String(error),
			body: "",
		};
	}
}

function mergeMedia(...groups: RedditMedia[][]): RedditMedia[] {
	const result: RedditMedia[] = [];
	const seen = new Set<string>();
	for (const media of groups.flat()) {
		if (seen.has(media.url)) continue;
		seen.add(media.url);
		result.push(media);
	}
	return result;
}

function renderRedditMarkdown(
	url: RedditPostUrl,
	rss: RedditRssData | undefined,
	embed: RedditEmbedData | undefined,
	oembed: RedditOEmbedData | undefined,
	rssAttempt: FetchAttempt,
): string {
	const post = rss?.post;
	const title = post?.title ?? embed?.title ?? oembed?.title ?? `Reddit post ${url.postId}`;
	const author = post?.author ?? embed?.author ?? oembed?.author;
	const comments = rss?.comments ?? [];
	const displayed = embed?.displayedCommentCount;
	const commentsTruncated = displayed !== undefined && displayed > comments.length;
	// Embed has full gallery media; RSS usually repeats only a small thumbnail.
	const media = embed?.media.length ? embed.media : mergeMedia(post?.media ?? []);
	const sources = [rss && "RSS", embed && "Embed", oembed && "oEmbed"].filter(Boolean).join(", ");

	const lines: string[] = [`# ${title}`, ""];
	if (author) lines.push(`- Author: ${author}`);
	lines.push(`- Permalink: ${post?.permalink || url.permalink}`);
	if (post?.updated) lines.push(`- Updated: ${post.updated}`);
	if (rss) {
		const count = displayed === undefined
			? `${comments.length} fetched; displayed total unavailable`
			: `${comments.length} fetched / ${displayed} displayed${commentsTruncated ? " — incomplete" : ""}`;
		lines.push(`- Comments: ${count}`);
	} else {
		lines.push(`- Comments: unavailable${displayed === undefined ? "" : `; Reddit displays ${displayed}`}`);
	}
	lines.push(`- Sources: ${sources || "none"}`);

	if (!rss) {
		if (rssAttempt.status === 429) {
			const retry = rssAttempt.retryAfter ?? rssAttempt.rateLimitReset;
			lines.push(`- Notice: Reddit RSS was rate limited (HTTP 429)${retry ? `; retry indicated after ${retry} seconds` : ""}. Comment bodies could not be retrieved.`);
		} else {
			lines.push(`- Notice: Reddit RSS was unavailable${rssAttempt.status ? ` (HTTP ${rssAttempt.status})` : ""}. Comment bodies could not be retrieved.`);
		}
	}

	lines.push("", "## Post", "", post?.bodyMarkdown || "Post body unavailable from the accessible Reddit endpoints.");

	if (media.length > 0) {
		lines.push("", "## Media", "");
		for (const item of media) lines.push(`- ${item.alt ? `[${item.alt}](${item.url})` : item.url}`);
	}

	if (rss) {
		lines.push("", `## Comments (${comments.length} retrieved)`, "");
		lines.push("Reddit RSS does not expose scores, parent IDs, or reliable thread hierarchy.", "");
		for (const [index, comment] of comments.entries()) {
			lines.push(`### ${index + 1}. ${comment.author ?? "Deleted or unknown user"}`);
			if (comment.updated) lines.push(`Updated: ${comment.updated}`);
			if (comment.permalink) lines.push(`[Permalink](${comment.permalink})`);
			lines.push("", comment.bodyMarkdown || "[No retrievable comment body]", "");
		}
	}

	return lines.join("\n").trim();
}

export async function fetchRedditPost(
	rawUrl: string,
	signal?: AbortSignal,
	fetcher: typeof fetch = fetch,
): Promise<OptimizedFetchResult> {
	const url = parseRedditPostUrl(rawUrl);
	if (!url) throw new Error(`Not a supported Reddit post URL: ${rawUrl}`);

	const rssAttempt = await fetchText(url.rssUrl, signal, fetcher);
	const rss = rssAttempt.ok ? parseRedditAtom(rssAttempt.body) : undefined;

	// Embed is complementary to RSS (gallery media and displayed comment count),
	// and is also the immediate fallback when anonymous RSS is rate limited.
	const embedAttempt = await fetchText(url.embedUrl, signal, fetcher);
	const embed = embedAttempt.ok ? parseRedditEmbed(embedAttempt.body) : undefined;

	let oembed: RedditOEmbedData | undefined;
	let oembedAttempt: FetchAttempt | undefined;
	if (!rss && !embed) {
		oembedAttempt = await fetchText(url.oembedUrl, signal, fetcher);
		oembed = oembedAttempt.ok ? parseOEmbed(oembedAttempt.body) : undefined;
	}

	if (!rss && !embed && !oembed) {
		const summaries = [
			`RSS: ${rssAttempt.status || rssAttempt.statusText}`,
			`Embed: ${embedAttempt.status || embedAttempt.statusText}`,
			`oEmbed: ${oembedAttempt?.status || oembedAttempt?.statusText || "not attempted"}`,
		];
		throw new Error(`Unable to fetch Reddit post ${url.postId} (${summaries.join("; ")})`);
	}

	return {
		url: url.permalink,
		markdown: renderRedditMarkdown(url, rss, embed, oembed, rssAttempt),
		scripts: [],
		method: "optimized",
		ttlMs: rss ? REDDIT_RSS_CACHE_TTL_MS : REDDIT_FALLBACK_CACHE_TTL_MS,
	};
}

export const redditOptimizer: FetchOptimizer = {
	id: "reddit",
	match(url) {
		return parseRedditPostUrl(url) !== undefined;
	},
	cacheKey(url) {
		return parseRedditPostUrl(url)?.cacheKey;
	},
	fetch({ url, signal }) {
		return fetchRedditPost(url, signal);
	},
};
