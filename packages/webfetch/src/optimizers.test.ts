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

test("x html optimizer hook falls back to default html processing for now", async () => {
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
