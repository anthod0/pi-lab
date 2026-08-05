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
