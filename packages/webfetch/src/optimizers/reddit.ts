import { DOMParser, parseHTML } from "linkedom";
import { htmlToMarkdown } from "../content.js";
import type { FetchOptimizer, OptimizedFetchResult } from "./types.js";

const REDDIT_RSS_CACHE_TTL_MS = 60 * 60 * 1000;
const REDDIT_FALLBACK_CACHE_TTL_MS = 60 * 1000;
const MEDIA_EXPIRY_SAFETY_MS = 60 * 1000;
const MAX_PACKAGED_MEDIA_JSON_LENGTH = 1024 * 1024;
const MAX_VIDEO_DIMENSION = 16_384;
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

interface RedditVideo {
	downloadUrl?: string;
	width?: number;
	height?: number;
	durationSeconds?: number;
	hlsUrl?: string;
	expiresAt?: number;
}

interface RedditEmbedData {
	title?: string;
	author?: string;
	displayedCommentCount?: number;
	media: RedditMedia[];
	video?: RedditVideo;
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

function validVideoDimension(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_VIDEO_DIMENSION
		? value
		: undefined;
}

function parseUnixExpiry(value: string | null): number | undefined {
	if (!value || !/^\d{10}$/.test(value)) return undefined;
	const seconds = Number(value);
	return Number.isSafeInteger(seconds) && seconds >= 1_000_000_000 ? seconds * 1000 : undefined;
}

export function parseRedditVideoExpiry(url: string): number | undefined {
	try {
		const parsed = new URL(url);
		if (parsed.hostname.toLowerCase() === "packaged-media.redd.it") {
			return parseUnixExpiry(parsed.searchParams.get("e"));
		}
		if (parsed.hostname.toLowerCase() === "v.redd.it") {
			return parseUnixExpiry(parsed.searchParams.get("a")?.split(",", 1)[0] ?? null);
		}
	} catch {
		// Invalid media URLs have no usable expiry.
	}
	return undefined;
}

function parseTrustedMediaUrl(rawUrl: unknown, hostname: string, extension: string): string | undefined {
	if (typeof rawUrl !== "string" || /[\u0000-\u001f\u007f]/.test(rawUrl)) return undefined;
	try {
		const url = new URL(rawUrl);
		if (
			url.protocol !== "https:"
			|| url.hostname.toLowerCase() !== hostname
			|| url.username
			|| url.password
			|| !url.pathname.toLowerCase().endsWith(extension)
		) return undefined;
		return rawUrl;
	} catch {
		return undefined;
	}
}

function isFreshMediaUrl(url: string, now: number): boolean {
	const expiresAt = parseRedditVideoExpiry(url);
	return expiresAt === undefined || expiresAt - now > MEDIA_EXPIRY_SAFETY_MS;
}

function focalRedditPlayer(document: Document, postId?: string): Element | undefined {
	const players = Array.from(document.querySelectorAll("shreddit-player"));
	if (postId) {
		const expected = `t3_${postId.toLowerCase()}`;
		const matching = players.find((player) => cleanText(player.getAttribute("post-id"))?.toLowerCase() === expected);
		if (matching) return matching;
	}
	if (players.length !== 1) return undefined;
	const player = players[0];
	const playerPostId = cleanText(player?.getAttribute("post-id"))?.toLowerCase();
	if (postId && playerPostId && playerPostId !== `t3_${postId.toLowerCase()}`) return undefined;
	return player;
}

function parseRedditPackagedVideo(player: Element, now: number): RedditVideo | undefined {
	const packagedJson = player.getAttribute("packaged-media-json");
	let playbackMp4s: Record<string, unknown> | undefined;
	if (packagedJson && packagedJson.length <= MAX_PACKAGED_MEDIA_JSON_LENGTH) {
		try {
			const root = JSON.parse(packagedJson) as unknown;
			if (root && typeof root === "object") {
				const playback = (root as Record<string, unknown>).playbackMp4s;
				if (playback && typeof playback === "object") playbackMp4s = playback as Record<string, unknown>;
			}
		} catch {
			// Video enrichment is best effort; image and post parsing continue below.
		}
	}

	const candidates: Array<RedditVideo & { index: number }> = [];
	const permutations = playbackMp4s?.permutations;
	if (Array.isArray(permutations)) {
		for (const [index, permutation] of permutations.entries()) {
			if (!permutation || typeof permutation !== "object") continue;
			const source = (permutation as Record<string, unknown>).source;
			if (!source || typeof source !== "object") continue;
			const sourceData = source as Record<string, unknown>;
			const downloadUrl = parseTrustedMediaUrl(sourceData.url, "packaged-media.redd.it", ".mp4");
			if (!downloadUrl || !isFreshMediaUrl(downloadUrl, now)) continue;
			const dimensions = sourceData.dimensions;
			if (dimensions !== undefined && (!dimensions || typeof dimensions !== "object" || Array.isArray(dimensions))) continue;
			const dimensionsData = dimensions as Record<string, unknown> | undefined;
			const width = validVideoDimension(dimensionsData?.width);
			const height = validVideoDimension(dimensionsData?.height);
			if ((dimensionsData?.width !== undefined && width === undefined) || (dimensionsData?.height !== undefined && height === undefined)) continue;
			candidates.push({
				downloadUrl,
				width,
				height,
				expiresAt: parseRedditVideoExpiry(downloadUrl),
				index,
			});
		}
	}
	candidates.sort((a, b) => {
		const areaDifference = (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0);
		return areaDifference || (b.width ?? 0) - (a.width ?? 0) || a.index - b.index;
	});

	const playerHls = cleanText(player.getAttribute("src"));
	const sourceHls = cleanText(player.querySelector("source")?.getAttribute("src"));
	const hlsUrl = [playerHls, sourceHls]
		.map((url) => parseTrustedMediaUrl(url, "v.redd.it", ".m3u8"))
		.find((url): url is string => Boolean(url && isFreshMediaUrl(url, now)));
	const preferred = candidates[0];
	if (!preferred && !hlsUrl) return undefined;

	const duration = playbackMp4s?.duration;
	const durationSeconds = typeof duration === "number" && Number.isFinite(duration) && duration >= 0 ? duration : undefined;
	const expiries = [preferred?.expiresAt, hlsUrl ? parseRedditVideoExpiry(hlsUrl) : undefined]
		.filter((expiry): expiry is number => expiry !== undefined);
	return {
		downloadUrl: preferred?.downloadUrl,
		width: preferred?.width,
		height: preferred?.height,
		durationSeconds,
		hlsUrl,
		expiresAt: expiries.length > 0 ? Math.min(...expiries) : undefined,
	};
}

export function parseRedditEmbed(html: string, postId?: string, now = Date.now()): RedditEmbedData | undefined {
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

	const player = focalRedditPlayer(document, postId);
	const video = player ? parseRedditPackagedVideo(player, now) : undefined;
	if (!title && !author && media.length === 0 && displayedCommentCount === undefined && !video) return undefined;
	return { title, author, displayedCommentCount, media, video };
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

function renderRedditVideo(video: RedditVideo): string[] {
	const lines: string[] = [];
	if (video.downloadUrl) {
		const dimensions = video.width && video.height ? `, ${video.width}×${video.height}` : "";
		lines.push(`- [Download video (MP4${dimensions})](${video.downloadUrl})`);
	}
	if (video.hlsUrl && video.hlsUrl !== video.downloadUrl) {
		lines.push(`- [Adaptive video stream (HLS)](${video.hlsUrl})`);
	}
	return lines;
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

	const videoLines = embed?.video ? renderRedditVideo(embed.video) : [];
	if (videoLines.length > 0 || media.length > 0) {
		lines.push("", "## Media", "", ...videoLines);
		const videoUrls = new Set([embed?.video?.downloadUrl, embed?.video?.hlsUrl].filter(Boolean));
		for (const item of media) {
			if (!videoUrls.has(item.url)) lines.push(`- ${item.alt ? `[${item.alt}](${item.url})` : item.url}`);
		}
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
	now = Date.now(),
): Promise<OptimizedFetchResult> {
	const url = parseRedditPostUrl(rawUrl);
	if (!url) throw new Error(`Not a supported Reddit post URL: ${rawUrl}`);

	const rssAttempt = await fetchText(url.rssUrl, signal, fetcher);
	const rss = rssAttempt.ok ? parseRedditAtom(rssAttempt.body) : undefined;

	// Embed is complementary to RSS (gallery media and displayed comment count),
	// and is also the immediate fallback when anonymous RSS is rate limited.
	const embedAttempt = await fetchText(url.embedUrl, signal, fetcher);
	const embed = embedAttempt.ok ? parseRedditEmbed(embedAttempt.body, url.postId, now) : undefined;

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

	const baseTtlMs = rss ? REDDIT_RSS_CACHE_TTL_MS : REDDIT_FALLBACK_CACHE_TTL_MS;
	const mediaTtlMs = embed?.video?.expiresAt === undefined
		? undefined
		: embed.video.expiresAt - now - MEDIA_EXPIRY_SAFETY_MS;
	return {
		url: url.permalink,
		markdown: renderRedditMarkdown(url, rss, embed, oembed, rssAttempt),
		scripts: [],
		method: "optimized",
		ttlMs: mediaTtlMs === undefined ? baseTtlMs : Math.min(baseTtlMs, mediaTtlMs),
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
