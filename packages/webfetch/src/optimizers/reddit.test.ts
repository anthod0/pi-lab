import assert from "node:assert/strict";
import test from "node:test";

import { mergeConfig } from "../config.js";
import { isTextContentType } from "../fetch.js";
import { applyFetchOptimizations } from "./index.js";
import {
	fetchRedditPost,
	parseRedditAtom,
	parseRedditEmbed,
	parseRedditPostUrl,
} from "./reddit.js";

const POST_URL = "https://www.reddit.com/r/Test/comments/abc123/example_slug/";

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>t3_abc123</id>
    <title>Example &amp; title</title>
    <author><name>/u/poster</name></author>
    <content type="html">&lt;table&gt;&lt;tr&gt;&lt;td&gt;&lt;img src="https://preview.redd.it/thumb.png" alt="Preview" /&gt;&lt;/td&gt;&lt;td&gt;&lt;div class="md"&gt;&lt;p&gt;Full &lt;strong&gt;post&lt;/strong&gt; body.&lt;/p&gt;&lt;/div&gt;&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;</content>
    <updated>2026-08-05T01:00:00Z</updated>
    <link href="https://www.reddit.com/r/Test/comments/abc123/example_slug/" />
  </entry>
  <entry>
    <id>t1_comment1</id>
    <title>/u/commenter on Example</title>
    <author><name>/u/commenter</name></author>
    <content type="html">&lt;div class="md"&gt;&lt;p&gt;A useful comment.&lt;/p&gt;&lt;/div&gt;</content>
    <updated>2026-08-05T02:00:00Z</updated>
    <link href="https://www.reddit.com/r/Test/comments/abc123/example_slug/comment1/" />
  </entry>
</feed>`;

const EMBED = `<!doctype html><html><body>
<a id="embed-title">Example &amp; title</a>
<a href="https://www.reddit.com/user/poster/">poster</a>
<img alt="Gallery image" src="https://preview.redd.it/gallery.png?width=640" srcset="https://preview.redd.it/gallery.png?width=320 320w, https://preview.redd.it/gallery.png?width=960 960w" />
<a data-testid="cta">View 3 comments</a>
</body></html>`;

const NOW_MS = 1_900_000_000_000;
const FRESH_EXPIRY_SECONDS = 1_900_003_600;

interface VideoSourceFixture {
	url: string;
	width?: number;
	height?: number;
}

function escapeHtmlAttribute(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("'", "&#39;");
}

function playerHtml({
	postId = "t3_abc123",
	sources = [],
	duration = 31,
	hls = `https://v.redd.it/video123/HLSPlaylist.m3u8?a=${FRESH_EXPIRY_SECONDS}%2Csigned`,
	packagedJson,
}: {
	postId?: string | undefined;
	sources?: VideoSourceFixture[];
	duration?: number;
	hls?: string;
	packagedJson?: string;
} = {}): string {
	const json = packagedJson ?? JSON.stringify({
		playbackMp4s: {
			duration,
			permutations: sources.map((source) => ({
				source: {
					url: source.url,
					dimensions: source.width === undefined || source.height === undefined
						? undefined
						: { width: source.width, height: source.height },
				},
			})),
		},
	});
	return `<shreddit-player${postId ? ` post-id="${postId}"` : ""} src="${hls}" packaged-media-json='${escapeHtmlAttribute(json)}'><source src="${hls}" type="application/vnd.apple.mpegURL" /></shreddit-player>`;
}

function videoUrl(name: string, expiry = FRESH_EXPIRY_SECONDS): string {
	return `https://packaged-media.redd.it/video123/pb/${name}.mp4?e=${expiry}&s=signed-${name}`;
}

function videoEmbed(players: string, extra = ""): string {
	return `<!doctype html><html><body><a id="embed-title">Example &amp; title</a>${players}${extra}</body></html>`;
}

test("normalizes Reddit post and comment permalinks to one post cache key", () => {
	const post = parseRedditPostUrl(`${POST_URL}?utm_source=share`);
	const comment = parseRedditPostUrl(`${POST_URL}comment1/?context=3`);

	assert.equal(post?.postId, "abc123");
	assert.equal(post?.rssUrl, `${POST_URL}.rss?limit=500&sort=top`);
	assert.match(post?.embedUrl ?? "", /^https:\/\/embed\.reddit\.com\//);
	assert.equal(comment?.permalink, POST_URL);
	assert.equal(post?.cacheKey, "reddit:post:abc123");
	assert.equal(comment?.cacheKey, post?.cacheKey);

	const optimization = applyFetchOptimizations(`${POST_URL}comment1/?context=3`, mergeConfig());
	assert.equal(optimization.optimizerId, "reddit");
	assert.equal(optimization.cacheKey, "reddit:post:abc123");
});

test("parses Reddit Atom post body and flat comments structurally", () => {
	const parsed = parseRedditAtom(RSS);

	assert.equal(parsed?.post.title, "Example & title");
	assert.equal(parsed?.post.author, "u/poster");
	assert.equal(parsed?.post.bodyMarkdown, "Full **post** body.");
	assert.equal(parsed?.post.media[0]?.url, "https://preview.redd.it/thumb.png");
	assert.equal(parsed?.comments.length, 1);
	assert.equal(parsed?.comments[0]?.bodyMarkdown, "A useful comment.");
});

test("parses Embed gallery media and displayed comment count", () => {
	const parsed = parseRedditEmbed(EMBED);

	assert.equal(parsed?.displayedCommentCount, 3);
	assert.equal(parsed?.author, "poster");
	assert.equal(parsed?.media[0]?.url, "https://preview.redd.it/gallery.png?width=960");
});

test("extracts the highest-resolution packaged video and signed HLS", () => {
	const parsed = parseRedditEmbed(videoEmbed(playerHtml({
		sources: [
			{ url: videoUrl("220p"), width: 340, height: 220 },
			{ url: videoUrl("720p"), width: 1110, height: 720 },
			{ url: videoUrl("1080p"), width: 1664, height: 1080 },
		],
	})), "abc123", NOW_MS);

	assert.equal(parsed?.video?.downloadUrl, videoUrl("1080p"));
	assert.equal(parsed?.video?.width, 1664);
	assert.equal(parsed?.video?.height, 1080);
	assert.equal(parsed?.video?.durationSeconds, 31);
	assert.equal(parsed?.video?.hlsUrl, `https://v.redd.it/video123/HLSPlaylist.m3u8?a=${FRESH_EXPIRY_SECONDS}%2Csigned`);
});

test("selects the largest video independently of permutation order", () => {
	const low = { url: videoUrl("low"), width: 640, height: 360 };
	const high = { url: videoUrl("high"), width: 1920, height: 1080 };
	for (const sources of [[high, low], [low, high], [low, high, low]]) {
		const parsed = parseRedditEmbed(videoEmbed(playerHtml({ sources })), "abc123", NOW_MS);
		assert.equal(parsed?.video?.downloadUrl, high.url);
	}
});

test("associates video with the focal post and rejects ambiguous players", () => {
	const wrong = playerHtml({ postId: "t3_reply", sources: [{ url: videoUrl("wrong"), width: 2000, height: 1200 }] });
	const focal = playerHtml({ sources: [{ url: videoUrl("focal"), width: 640, height: 360 }] });
	assert.equal(parseRedditEmbed(videoEmbed(wrong + focal), "abc123", NOW_MS)?.video?.downloadUrl, videoUrl("focal"));

	const ambiguous = playerHtml({ sources: [{ url: videoUrl("one"), width: 640, height: 360 }] }).replace(' post-id="t3_abc123"', "")
		+ playerHtml({ sources: [{ url: videoUrl("two"), width: 1280, height: 720 }] }).replace(' post-id="t3_abc123"', "");
	assert.equal(parseRedditEmbed(videoEmbed(ambiguous), "abc123", NOW_MS)?.video, undefined);
});

test("fails open for malformed, missing, and oversized packaged metadata", () => {
	for (const packagedJson of ["{bad", "null", JSON.stringify({ playbackMp4s: { permutations: null } }), "x".repeat(1024 * 1024 + 1)]) {
		const parsed = parseRedditEmbed(videoEmbed(playerHtml({ packagedJson }), '<img alt="Poster" src="https://preview.redd.it/poster.png" />'), "abc123", NOW_MS);
		assert.equal(parsed?.video?.downloadUrl, undefined);
		assert.equal(parsed?.media[0]?.url, "https://preview.redd.it/poster.png");
	}
});

test("validates packaged MP4 and HLS URLs and preserves signed query strings", () => {
	const invalid = [
		"http://packaged-media.redd.it/video/bad.mp4",
		"https://user:pass@packaged-media.redd.it/video/bad.mp4",
		"https://packaged-media.redd.it.example.com/video/bad.mp4",
		"https://packaged-media.redd.it/video/bad.webm",
		"https://packaged-media.redd.it/video/bad.mp4%0Aevil",
	];
	const valid = videoUrl("valid");
	const parsed = parseRedditEmbed(videoEmbed(playerHtml({
		sources: [
			...invalid.map((url) => ({ url, width: 4000, height: 3000 })),
			{ url: videoUrl("invalid-dimensions"), width: 20_000, height: 10_000 },
			{ url: valid, width: 640, height: 360 },
		],
	})), "abc123", NOW_MS);
	assert.equal(parsed?.video?.downloadUrl, valid);

	for (const hls of [
		"http://v.redd.it/video/master.m3u8",
		"https://v.redd.it.example.com/video/master.m3u8",
		"https://v.redd.it/video/preview.mp4",
	]) {
		const result = parseRedditEmbed(videoEmbed(playerHtml({ hls, sources: [] })), "abc123", NOW_MS);
		assert.equal(result?.video?.hlsUrl, undefined);
	}
});

test("omits expired and near-expiry video URLs while considering fresh lower resolutions", () => {
	const parsed = parseRedditEmbed(videoEmbed(playerHtml({
		sources: [
			{ url: videoUrl("expired-high", 1_899_999_999), width: 1920, height: 1080 },
			{ url: videoUrl("near", 1_900_000_060), width: 1280, height: 720 },
			{ url: videoUrl("fresh-low"), width: 640, height: 360 },
		],
	})), "abc123", NOW_MS);
	assert.equal(parsed?.video?.downloadUrl, videoUrl("fresh-low"));
});

test("fetches RSS first and enriches the result from Embed", async () => {
	const requested: string[] = [];
	const fetcher: typeof fetch = async (input) => {
		const url = String(input);
		requested.push(url);
		if (url.includes(".rss")) return new Response(RSS, { status: 200, headers: { "content-type": "application/atom+xml" } });
		if (url.startsWith("https://embed.reddit.com")) return new Response(EMBED, { status: 200, headers: { "content-type": "text/html" } });
		throw new Error(`Unexpected URL: ${url}`);
	};

	const result = await fetchRedditPost(POST_URL, undefined, fetcher);

	assert.equal(requested.length, 2);
	assert.match(requested[0], /\.rss\?limit=500&sort=top$/);
	assert.match(requested[1], /^https:\/\/embed\.reddit\.com\//);
	assert.match(result.markdown, /Full \*\*post\*\* body\./);
	assert.match(result.markdown, /1 fetched \/ 3 displayed — incomplete/);
	assert.match(result.markdown, /A useful comment\./);
	assert.match(result.markdown, /gallery\.png\?width=960/);
	assert.equal(result.ttlMs, 60 * 60 * 1000);
});

test("enriches first-call Markdown with video without probing media and caps cache TTL", async () => {
	const mp4 = videoUrl("1080p", 1_900_001_800);
	const embed = videoEmbed(playerHtml({ sources: [{ url: mp4, width: 1664, height: 1080 }] }), `
		<img alt="Poster image" src="https://external-preview.redd.it/poster.png" />
		<a data-testid="cta">View 3 comments</a>`);
	const requested: string[] = [];
	const fetcher: typeof fetch = async (input) => {
		const url = String(input);
		requested.push(url);
		if (url.includes(".rss")) return new Response(RSS, { status: 200 });
		if (url.startsWith("https://embed.reddit.com")) return new Response(embed, { status: 200 });
		throw new Error(`Media URL must not be fetched: ${url}`);
	};

	const result = await fetchRedditPost(POST_URL, undefined, fetcher, NOW_MS);
	assert.equal(requested.length, 2);
	assert.match(result.markdown, /Full \*\*post\*\* body/);
	assert.match(result.markdown, /A useful comment/);
	assert.match(result.markdown, /1 fetched \/ 3 displayed/);
	assert.match(result.markdown, new RegExp(`Download video \\(MP4, 1664×1080\\).*${mp4.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
	assert.match(result.markdown, /Adaptive video stream \(HLS\)/);
	assert.match(result.markdown, /\[Poster image\]/);
	assert.equal(result.ttlMs, 29 * 60 * 1000);
});

test("falls back immediately to Embed metadata when RSS is rate limited", async () => {
	const requested: string[] = [];
	const fetcher: typeof fetch = async (input) => {
		const url = String(input);
		requested.push(url);
		if (url.includes(".rss")) {
			return new Response("", { status: 429, headers: { "retry-after": "55" } });
		}
		if (url.startsWith("https://embed.reddit.com")) return new Response(EMBED, { status: 200 });
		throw new Error(`Unexpected URL: ${url}`);
	};

	const result = await fetchRedditPost(POST_URL, undefined, fetcher);

	assert.equal(requested.length, 2, "oEmbed and normal Reddit HTML should not be requested");
	assert.match(result.markdown, /rate limited \(HTTP 429\)/);
	assert.match(result.markdown, /retry indicated after 55 seconds/);
	assert.match(result.markdown, /Comment bodies could not be retrieved/);
	assert.match(result.markdown, /View|Example & title/);
	assert.equal(result.ttlMs, 60 * 1000, "rate-limited fallbacks should be retried after a short cache period");
});

test("rate-limit fallback still renders video and does not request oEmbed", async () => {
	const requested: string[] = [];
	const mp4 = videoUrl("fallback");
	const fetcher: typeof fetch = async (input) => {
		const url = String(input);
		requested.push(url);
		if (url.includes(".rss")) return new Response("", { status: 429 });
		if (url.startsWith("https://embed.reddit.com")) {
			return new Response(videoEmbed(playerHtml({ sources: [{ url: mp4, width: 640, height: 360 }] })), { status: 200 });
		}
		throw new Error(`Unexpected URL: ${url}`);
	};
	const result = await fetchRedditPost(POST_URL, undefined, fetcher, NOW_MS);
	assert.equal(requested.length, 2);
	assert.match(result.markdown, /rate limited/);
	assert.match(result.markdown, /Download video/);
	assert.match(result.markdown, new RegExp(mp4.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	assert.equal(result.ttlMs, 60 * 1000);
});

test("does not execute JavaScript-like packaged metadata", () => {
	delete (globalThis as { __redditVideoSideEffect?: boolean }).__redditVideoSideEffect;
	const packagedJson = `globalThis.__redditVideoSideEffect=true;${JSON.stringify({ playbackMp4s: { permutations: [] } })}`;
	const parsed = parseRedditEmbed(videoEmbed(playerHtml({ packagedJson })), "abc123", NOW_MS);
	assert.equal(parsed?.video?.downloadUrl, undefined);
	assert.equal((globalThis as { __redditVideoSideEffect?: boolean }).__redditVideoSideEffect, undefined);
});

test("uses oEmbed only when RSS and Embed are both unavailable", async () => {
	const requested: string[] = [];
	const fetcher: typeof fetch = async (input) => {
		const url = String(input);
		requested.push(url);
		if (url.includes("/oembed?")) {
			return new Response(JSON.stringify({ title: "Minimal post", author_name: "fallback_author" }), { status: 200 });
		}
		return new Response("blocked", { status: 403 });
	};

	const result = await fetchRedditPost(POST_URL, undefined, fetcher);

	assert.equal(requested.length, 3);
	assert.match(requested[2], /^https:\/\/www\.reddit\.com\/oembed\?/);
	assert.match(result.markdown, /^# Minimal post/);
	assert.match(result.markdown, /Author: fallback_author/);
	assert.match(result.markdown, /Sources: oEmbed/);
});

test("treats JSON and feed XML MIME types as text", () => {
	for (const contentType of [
		"application/json; charset=utf-8",
		"application/atom+xml",
		"application/rss+xml",
		"application/xml",
		"text/xml",
	]) {
		assert.equal(isTextContentType(contentType), true, contentType);
	}
	assert.equal(isTextContentType("application/pdf"), false);
});
