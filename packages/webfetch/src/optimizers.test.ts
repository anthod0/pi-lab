import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_CONFIG, loadWebFetchConfig, mergeConfig } from "./config";
import { processHtmlWithOptimizations } from "./optimizers";
import { processHtml } from "./content";

const POST_URL = "https://x.com/example/status/123";
const VIDEO_URL = "https://video.twimg.com/focal/best.mp4?tag=29&test=1";
const THUMBNAIL_URL = "https://pbs.twimg.com/amplify_video_thumb/example/poster.jpg";

test("webfetch optimizations are enabled by default", () => {
	assert.equal(DEFAULT_CONFIG.optimizations, true);
	assert.equal(mergeConfig().optimizations, true);
});

test("mergeConfig can disable webfetch optimizations globally", () => {
	assert.equal(mergeConfig({ optimizations: false }).optimizations, false);
});

test("loadWebFetchConfig reads simple settings boolean", () => {
	assert.equal(loadWebFetchConfig({ webfetch: { optimizations: false } }).optimizations, false);
	assert.equal(loadWebFetchConfig({ webfetch: { optimizations: true } }).optimizations, true);
});

function streamScript(payload: string, kind = "Result.Ok"): string {
	return `($R=>$R[30].next($R[33]={kind:"GraphQLRequestStream.Completed",requestId:1,key:"query",result:$R[34]={kind:${JSON.stringify(kind)},value:${JSON.stringify(payload)}}}))($R["tsr"]);document.currentScript.remove();`;
}

function streamHtml(scripts: string[], body = "<main>Post</main>"): string {
	return `<html><body>${body}${scripts.map((script) => `<script>${script}</script>`).join("")}</body></html>`;
}

function videoTweet(statusId = "123", url = VIDEO_URL) {
	return {
		rest_id: statusId,
		media_entities2: [{
			type: "video",
			media_url_https: THUMBNAIL_URL,
			original_info: { width: 1920, height: 1080 },
			video_info: {
				duration_millis: 12633,
				variants: [
					{ bitrate: 256000, content_type: "video/mp4", url: "https://video.twimg.com/low.mp4" },
					{ bitrate: 10368000, content_type: "video/mp4", url },
					{ bitrate: 20000000, content_type: "video/mp4", url: "https://video.twimg.com/hevc/unsupported.mp4" },
					{ bitrate: 30000000, content_type: "application/x-mpegURL", url: "https://video.twimg.com/playlist.m3u8" },
				],
			},
		}],
	};
}

function tweetPayload(tweet: unknown): string {
	return JSON.stringify({ data: { tweet_result_by_rest_id: { rest_id: "123", result: tweet } } });
}

async function optimizeXFixture(html: string, url = POST_URL, optimizations = true) {
	return processHtmlWithOptimizations({
		url,
		html,
		config: mergeConfig({ optimizations }),
		defaultProcess: () => processHtml(html, url),
	});
}

test("x optimizer selects the best supported MP4 from a JSON-string stream response", async () => {
	const html = streamHtml([streamScript(tweetPayload(videoTweet()))]);
	const result = await optimizeXFixture(html);

	assert.ok(result.markdown.includes(VIDEO_URL));
	assert.ok(result.markdown.includes(THUMBNAIL_URL));
	assert.match(result.markdown, /12\.633/);
	assert.match(result.markdown, /1920×1080/);
	assert.doesNotMatch(result.markdown, /low\.mp4|unsupported\.mp4|playlist\.m3u8/);
});

test("x optimizer preserves generic content and inline scripts when adding a video", async () => {
	const html = streamHtml([streamScript(tweetPayload(videoTweet()))], '<main><a href="https://example.com/post">Post</a></main>');
	const result = await optimizeXFixture(html);
	const generic = await processHtml(html, POST_URL);

	assert.ok(result.markdown.includes(VIDEO_URL));
	assert.ok(result.markdown.startsWith(generic.markdown.trimEnd()));
	assert.deepEqual(result.scripts, generic.scripts);
});

test("x optimizer associates media with the focal tweet, not its wrapper, replies, or quotes", async () => {
	const payload = JSON.stringify({ data: {
		threaded_conversation_with_injections_v2: { instructions: [{ entries: [
			{ content: { tweet_results: { result: videoTweet("999", "https://video.twimg.com/reply/wrong.mp4") } } },
			{ content: { tweet_results: { rest_id: "123", result: {
				quoted_status_result: { result: videoTweet("456", "https://video.twimg.com/quote/wrong.mp4") },
				...videoTweet(),
			} } } },
		] }] },
	} });
	const result = await optimizeXFixture(streamHtml([streamScript(payload)]));

	assert.ok(result.markdown.includes(VIDEO_URL));
	assert.doesNotMatch(result.markdown, /wrong\.mp4/);
});

test("x optimizer falls back for missing, malformed, or unrelated data", async (t) => {
	for (const [name, payload] of [
		["malformed JSON", `{"data":${JSON.stringify(videoTweet())}`],
		["non-JSON expression", `(${tweetPayload(videoTweet())})`],
		["null response", "null"],
		["missing data", "{}"],
		["other post under focal wrapper", tweetPayload(videoTweet("999"))],
		["photo-only post", tweetPayload({ rest_id: "123", media_entities2: [{ type: "photo", media_url_https: THUMBNAIL_URL }] })],
		["malformed media", tweetPayload({ rest_id: "123", media_entities2: [null, { type: "video", video_info: { variants: [null, {}] } }] })],
	] as const) {
		await t.test(name, async () => {
			const html = streamHtml([streamScript(payload)]);
			assert.deepEqual(await optimizeXFixture(html), await processHtml(html, POST_URL));
		});
	}
});

test("x optimizer ignores unsuccessful or incomplete stream events", async (t) => {
	for (const [name, script] of [
		["failed result", streamScript(tweetPayload(videoTweet()), "Result.Error")],
		["payload expression", streamScript(tweetPayload(videoTweet())).replace("}}))", '+"junk"}}))')],
		["incomplete request", streamScript(tweetPayload(videoTweet())).replace("GraphQLRequestStream.Completed", "GraphQLRequestStream.Started")],
		["unterminated envelope", streamScript(tweetPayload(videoTweet())).split("}))")[0]],
	] as const) {
		await t.test(name, async () => {
			const html = streamHtml([script]);
			assert.deepEqual(await optimizeXFixture(html), await processHtml(html, POST_URL));
		});
	}
});

test("x optimizer continues past malformed responses to a valid stream event", async (t) => {
	const invalid = streamScript(`{"data":${JSON.stringify(videoTweet())}`);
	const valid = streamScript(tweetPayload(videoTweet()));
	for (const [name, scripts] of [
		["same script", [invalid + valid]],
		["separate scripts", [invalid, valid]],
	] as const) {
		await t.test(name, async () => {
			const result = await optimizeXFixture(streamHtml([...scripts]));
			assert.ok(result.markdown.includes(VIDEO_URL));
		});
	}
});

test("x optimizer rejects unsafe or unsupported video URLs", async (t) => {
	for (const [name, url] of [
		["http", "http://video.twimg.com/focal/video.mp4"],
		["wrong host", "https://example.com/focal/video.mp4"],
		["not mp4", "https://video.twimg.com/focal/playlist.m3u8"],
		["hevc", "https://video.twimg.com/focal/hevc/video.mp4"],
		["whitespace", "https://video.twimg.com/focal/video.mp4 bad"],
	] as const) {
		await t.test(name, async () => {
			const tweet = videoTweet();
			tweet.media_entities2[0].video_info.variants = [{ bitrate: 100, content_type: "video/mp4", url }];
			const html = streamHtml([streamScript(tweetPayload(tweet))]);
			assert.deepEqual(await optimizeXFixture(html), await processHtml(html, POST_URL));
		});
	}
});

test("x optimizer omits untrusted thumbnails without losing the video", async () => {
	const tweet = videoTweet();
	tweet.media_entities2[0].media_url_https = "https://example.com/untrusted.jpg";
	const result = await optimizeXFixture(streamHtml([streamScript(tweetPayload(tweet))]));

	assert.ok(result.markdown.includes(VIDEO_URL));
	assert.doesNotMatch(result.markdown, /untrusted\.jpg/);
});

test("x optimizer does not duplicate a video URL already in generic Markdown", async () => {
	const html = streamHtml([streamScript(tweetPayload(videoTweet()))], `<main><p>${VIDEO_URL}</p></main>`);
	const result = await optimizeXFixture(html);

	assert.equal(result.markdown.split(VIDEO_URL).length - 1, 1);
	assert.deepEqual(result, await processHtml(html, POST_URL));
});

test("x optimizer extracts animated GIF MP4s without requiring a bitrate", async () => {
	const tweet = videoTweet();
	const url = "https://video.twimg.com/tweet_video/animation.mp4";
	const media = { ...tweet.media_entities2[0], type: "animated_gif", video_info: {
		variants: [{ content_type: "video/mp4", url }],
	} };
	const result = await optimizeXFixture(streamHtml([streamScript(tweetPayload({ ...tweet, media_entities2: [media] }))]));

	assert.ok(result.markdown.includes(url));
});

test("x optimizer decodes escaped payload strings without executing page JavaScript", async () => {
	const payload = tweetPayload({ ...videoTweet(), details: { full_text: 'Quotes " and \\ backslash\n中文' } });
	const script = `throw new Error("Do not execute");${streamScript(payload)}`
		.replaceAll("https://video.twimg.com/", "https:\\u002f\\u002fvideo.twimg.com/");
	const result = await optimizeXFixture(streamHtml([script]));

	assert.ok(result.markdown.includes(VIDEO_URL));
});

test("x optimizer leaves ordinary pages and disabled optimizations unchanged", async (t) => {
	for (const [name, html, url, enabled] of [
		["no stream data", streamHtml([]), POST_URL, true],
		["not a status URL", streamHtml([streamScript(tweetPayload(videoTweet()))]), "https://x.com/example", true],
		["disabled", streamHtml([streamScript(tweetPayload(videoTweet()))]), POST_URL, false],
	] as const) {
		await t.test(name, async () => {
			assert.deepEqual(await optimizeXFixture(html, url, enabled), await processHtml(html, url));
		});
	}
});
