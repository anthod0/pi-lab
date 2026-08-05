import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_CONFIG, loadWebFetchConfig, mergeConfig } from "./config";
import { applyFetchOptimizations, processHtmlWithOptimizations } from "./optimizers";
import { processHtml } from "./content";

test("webfetch optimizations are enabled by default", () => {
	assert.equal(DEFAULT_CONFIG.optimizations, true);
	assert.equal(mergeConfig().optimizations, true);
});

test("mergeConfig can disable webfetch optimizations globally", () => {
	const config = mergeConfig({ optimizations: false });

	assert.equal(config.optimizations, false);
});

test("loadWebFetchConfig reads simple settings boolean", () => {
	assert.equal(loadWebFetchConfig({ webfetch: { optimizations: false } }).optimizations, false);
	assert.equal(loadWebFetchConfig({ webfetch: { optimizations: true } }).optimizations, true);
});

test("x html optimizer extracts tweet content from INITIAL_STATE script", async () => {
	const state = {
		entities: {
			tweets: {
				"1234567890123456789": {
					full_text: "Example post for optimizer tests.\n\nHighlights:\n✅ Extract text from script state\n✅ Decode &amp;amp; entities\n✅ Include media links https://t.co/example",
					created_at: "2026-05-09T14:31:10.000Z",
					favorite_count: 3,
					reply_count: 4,
					retweet_count: 0,
					quote_count: 0,
					user: "1111111111111111111",
					extended_entities: {
						media: [{ type: "photo", media_url_https: "https://pbs.twimg.com/media/example.jpg" }],
					},
				},
			},
			users: {
				"1111111111111111111": {
					name: "Example User",
					screen_name: "example_user",
				},
			},
		},
	};
	const html = `<!doctype html><html><head><script>window.__INITIAL_STATE__=${JSON.stringify(state)};</script></head><body><main>Something went wrong</main></body></html>`;

	const optimized = await processHtmlWithOptimizations({
		url: "https://x.com/example_user/status/1234567890123456789",
		html,
		config: mergeConfig(),
		defaultProcess: () => processHtml(html, "https://x.com/example_user/status/1234567890123456789"),
	});

	assert.equal(optimized.method, "optimized");
	assert.equal(optimized.scripts.length, 0);
	assert.match(optimized.markdown, /^# Tweet by Example User \(@example_user\)/);
	assert.match(optimized.markdown, /Example post for optimizer tests/);
	assert.match(optimized.markdown, /Decode & entities/);
	assert.match(optimized.markdown, /https:\/\/pbs\.twimg\.com\/media\/example\.jpg/);
	assert.doesNotMatch(optimized.markdown, /Something went wrong/);
});

test("x html optimizer selects the best downloadable mp4 video variant", async () => {
	const state = {
		entities: {
			tweets: {
				"1234567890123456790": {
					full_text: "Video post example https://t.co/video",
					user: "1111111111111111111",
					extended_entities: {
						media: [{
							type: "video",
							media_url_https: "https://pbs.twimg.com/ext_tw_video_thumb/example.jpg",
							video_info: {
								duration_millis: 12000,
								variants: [
									{ content_type: "application/x-mpegURL", url: "https://video.twimg.com/example/playlist.m3u8" },
									{ bitrate: 256000, content_type: "video/mp4", url: "https://video.twimg.com/example/480x270/low.mp4" },
									{ bitrate: 2176000, content_type: "video/mp4", url: "https://video.twimg.com/example/1280x720/best.mp4" },
									{ bitrate: 10368000, content_type: "video/mp4", url: "https://video.twimg.com/example/hevc/1920x1080/skip.mp4" },
								],
							},
						}],
					},
				},
			},
			users: {
				"1111111111111111111": { name: "Example User", screen_name: "example_user" },
			},
		},
	};
	const html = `<!doctype html><html><head><script>window.__INITIAL_STATE__=${JSON.stringify(state)};</script></head></html>`;

	const optimized = await processHtmlWithOptimizations({
		url: "https://x.com/example_user/status/1234567890123456790",
		html,
		config: mergeConfig(),
		defaultProcess: () => processHtml(html, "https://x.com/example_user/status/1234567890123456790"),
	});

	assert.match(optimized.markdown, /Video: https:\/\/video\.twimg\.com\/example\/1280x720\/best\.mp4/);
	assert.match(optimized.markdown, /Thumbnail: https:\/\/pbs\.twimg\.com\/ext_tw_video_thumb\/example\.jpg/);
	assert.doesNotMatch(optimized.markdown, /playlist\.m3u8/);
	assert.doesNotMatch(optimized.markdown, /skip\.mp4/);
});

function xSsrPosting(
	statusId: string,
	video?: {
		contentUrl: string;
		thumbnailUrl?: string;
		duration?: string;
		width?: number;
		height?: number;
	},
): Record<string, unknown> {
	return {
		"@type": "SocialMediaPosting",
		"@id": `https://x.com/i/status/${statusId}`,
		identifier: statusId,
		...(video ? { video: { "@type": "VideoObject", ...video } } : {}),
	};
}

function xSsrHtml(postings: Record<string, unknown>[], body = "<main><h1>Visible X post</h1><p>Visible reply.</p></main>"): string {
	const jsonLd = JSON.stringify(postings).replace(/"video":\{/g, "video:$R[24]={");
	return `<!doctype html><html><head><title>X post</title></head><body>${body}<script>self.$_TSR={headMetadata:{jsonLd:${jsonLd}}};</script></body></html>`;
}

async function optimizeXFixture(statusId: string, html: string) {
	const url = `https://x.com/example/status/${statusId}`;
	return processHtmlWithOptimizations({
		url,
		html,
		config: mergeConfig(),
		defaultProcess: () => processHtml(html, url),
	});
}

test("x html optimizer enriches current SSR video posts and preserves generic extraction", async () => {
	const html = xSsrHtml([
		xSsrPosting("2084697125099856216", {
			contentUrl: "https://video.twimg.com/amplify_video/2084696983319830528/vid/avc1/1280x720/best.mp4?tag=14",
			thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/example/img/example.jpg",
			duration: "PT38.016S",
			width: 1280,
			height: 720,
		}),
	]);

	const optimized = await optimizeXFixture("2084697125099856216", html);

	assert.match(optimized.markdown, /Visible X post/);
	assert.match(optimized.markdown, /Visible reply/);
	assert.match(optimized.markdown, /## Direct media/);
	assert.match(optimized.markdown, /Video \(MP4\): https:\/\/video\.twimg\.com\/amplify_video\/.+best\.mp4\?tag=14/);
	assert.match(optimized.markdown, /Thumbnail: https:\/\/pbs\.twimg\.com\/amplify_video_thumb\/example\/img\/example\.jpg/);
	assert.match(optimized.markdown, /Duration: 38\.016 seconds/);
	assert.match(optimized.markdown, /Dimensions: 1280×720/);
	assert.equal(optimized.scripts.length, 1);
	assert.match(optimized.scripts[0]?.content ?? "", /self\.\$_TSR/);
});

test("x SSR optimizer only returns media associated with the focal post", async () => {
	const html = xSsrHtml([
		xSsrPosting("999", { contentUrl: "https://video.twimg.com/reply/wrong.mp4" }),
		xSsrPosting("123", { contentUrl: "https://video.twimg.com/focal/correct.mp4?tag=1" }),
	]);

	const optimized = await optimizeXFixture("123", html);

	assert.match(optimized.markdown, /https:\/\/video\.twimg\.com\/focal\/correct\.mp4\?tag=1/);
	assert.doesNotMatch(optimized.markdown, /wrong\.mp4/);
});

test("x SSR optimizer leaves photo-only and malformed payloads unchanged", async (t) => {
	await t.test("photo-only", async () => {
		const body = '<main><h1>Photo post</h1><img src="https://pbs.twimg.com/media/photo.jpg"></main>';
		const html = xSsrHtml([xSsrPosting("123")], body);
		const optimized = await optimizeXFixture("123", html);
		const fallback = await processHtml(html, "https://x.com/example/status/123");

		assert.equal(optimized.markdown, fallback.markdown);
		assert.doesNotMatch(optimized.markdown, /## Direct media/);
	});

	await t.test("unterminated object", async () => {
		const html = '<html><body><main>Fallback content</main><script>self.$_TSR={headMetadata:{jsonLd:[{"@type":"SocialMediaPosting","identifier":"123","video":{"@type":"VideoObject","contentUrl":"https://video.twimg.com/focal/video.mp4"}</script></body></html>';
		const optimized = await optimizeXFixture("123", html);
		const fallback = await processHtml(html, "https://x.com/example/status/123");

		assert.equal(optimized.markdown, fallback.markdown);
	});
});

test("x SSR optimizer rejects unsafe or unexpected media URLs", async (t) => {
	for (const [name, contentUrl] of [
		["http", "http://video.twimg.com/focal/video.mp4"],
		["wrong host", "https://example.com/focal/video.mp4"],
		["not mp4", "https://video.twimg.com/focal/playlist.m3u8"],
		["hevc", "https://video.twimg.com/focal/hevc/video.mp4"],
		["whitespace", "https://video.twimg.com/focal/video.mp4 bad"],
	] as const) {
		await t.test(name, async () => {
			const html = xSsrHtml([xSsrPosting("123", { contentUrl })]);
			const optimized = await optimizeXFixture("123", html);
			assert.doesNotMatch(optimized.markdown, /## Direct media/);
		});
	}
});

test("x SSR optimizer does not duplicate a direct URL already in generic Markdown", async () => {
	const url = "https://video.twimg.com/focal/video.mp4?tag=7";
	const html = xSsrHtml([xSsrPosting("123", { contentUrl: url })], `<main><p>Download: ${url}</p></main>`);
	const optimized = await optimizeXFixture("123", html);

	assert.equal(optimized.markdown.split(url).length - 1, 1);
	assert.doesNotMatch(optimized.markdown, /## Direct media/);
});

test("x SSR optimizer labels tweet_video MP4 media as an animated GIF", async () => {
	const html = xSsrHtml([
		xSsrPosting("123", { contentUrl: "https://video.twimg.com/tweet_video/example.mp4" }),
	]);
	const optimized = await optimizeXFixture("123", html);

	assert.match(optimized.markdown, /GIF \(MP4\): https:\/\/video\.twimg\.com\/tweet_video\/example\.mp4/);
});

test("x SSR optimizer scans scripts as text without executing JavaScript", async () => {
	delete (globalThis as { __xOptimizerSideEffect?: boolean }).__xOptimizerSideEffect;
	const posting = JSON.stringify(xSsrPosting("123", { contentUrl: "https://video.twimg.com/focal/video.mp4" }));
	const html = `<html><body><main>Post</main><script>globalThis.__xOptimizerSideEffect=true;self.$_TSR={headMetadata:{jsonLd:[${posting}]}};</script></body></html>`;

	const optimized = await optimizeXFixture("123", html);

	assert.match(optimized.markdown, /https:\/\/video\.twimg\.com\/focal\/video\.mp4/);
	assert.equal((globalThis as { __xOptimizerSideEffect?: boolean }).__xOptimizerSideEffect, undefined);
});

test("x html optimizer hook falls back to default html processing when INITIAL_STATE is missing", async () => {
	const html = "<!doctype html><html><head><title>X</title><script>window.__DATA__ = {}</script></head><body><main><h1>Hello X</h1><p>Fallback content.</p></main></body></html>";
	const optimized = await processHtmlWithOptimizations({
		url: "https://x.com/example/status/123",
		html,
		config: mergeConfig(),
		defaultProcess: () => processHtml(html, "https://x.com/example/status/123"),
	});
	const defaultResult = await processHtml(html, "https://x.com/example/status/123");

	assert.equal(optimized.method, defaultResult.method);
	assert.equal(optimized.markdown, defaultResult.markdown);
	assert.deepEqual(optimized.scripts, defaultResult.scripts);
});
