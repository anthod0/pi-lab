import assert from "node:assert/strict";
import test from "node:test";
import { acceptHeaderForUrl } from "./fetch.js";

const TEXT_ACCEPT = "text/markdown, text/plain, text/html, */*";

test("uses a generic accept header for likely media and binary URLs", () => {
	for (const url of [
		"https://preview.redd.it/post-image.png?width=1080&auto=webp",
		"https://video.twimg.com/path/clip.MP4?tag=14",
		"https://example.com/audio/track.mp3",
		"https://example.com/files/document.pdf",
		"https://example.com/download/archive.zip",
	]) {
		assert.equal(acceptHeaderForUrl(url), "*/*", url);
	}
});

test("keeps text content negotiation for ordinary web page URLs", () => {
	for (const url of [
		"https://example.com/",
		"https://example.com/articles/story",
		"https://example.com/index.html",
		"https://example.com/api/data.json",
	]) {
		assert.equal(acceptHeaderForUrl(url), TEXT_ACCEPT, url);
	}
});
