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

test("reddit links are rewritten to old.reddit.com when optimizations are enabled", () => {
	const result = applyFetchOptimizations(
		"https://www.reddit.com/r/pi/comments/abc/example/?sort=top",
		mergeConfig(),
	);

	assert.equal(
		result.url,
		"https://old.reddit.com/r/pi/comments/abc/example/?sort=top",
	);
	assert.equal(result.optimizerId, "reddit");
});

test("reddit links are not rewritten when optimizations are disabled", () => {
	const originalUrl = "https://www.reddit.com/r/pi/comments/abc/example/?sort=top";
	const result = applyFetchOptimizations(
		originalUrl,
		mergeConfig({ optimizations: false }),
	);

	assert.equal(result.url, originalUrl);
	assert.equal(result.optimizerId, undefined);
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
