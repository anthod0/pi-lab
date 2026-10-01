import assert from "node:assert/strict";
import test from "node:test";

import { loadXSearchConfig } from "./config.js";
import {
  buildCandidatePrompt,
  buildUserCandidatePrompt,
  deriveUserCitations,
  collectMedia,
  deriveCitations,
  extractUrls,
  statusId,
  synthesizeAnswer,
  synthesizeUserAnswer,
  toBase64,
  type ImageAttachment,
  type SynthesisDeps,
  type SynthesisModel,
} from "./synthesize.js";
import type { Tweet } from "./twitterapi.js";

const CONFIG = loadXSearchConfig({});
const MODEL: SynthesisModel = { provider: "anthropic", id: "claude-haiku", supportsImage: false };

function tweet(overrides: Partial<Tweet> = {}): Tweet {
  return {
    id: "1",
    url: "https://x.com/alice/status/111",
    text: "hello world",
    createdAt: "Mon Sep 21 10:00:00 +0000 2026",
    author: { userName: "alice", name: "Alice" },
    likeCount: 12,
    retweetCount: 3,
    viewCount: 400,
    ...overrides,
  };
}

function deps(overrides: Partial<SynthesisDeps> = {}): SynthesisDeps {
  return {
    complete: async () => "Answer (https://x.com/alice/status/111).",
    ...overrides,
  };
}

test("buildCandidatePrompt lists every permalink and marks media", () => {
  const prompt = buildCandidatePrompt("query here", [
    tweet(),
    tweet({ id: "2", url: "https://x.com/bob/status/222", text: "second", media: [{ type: "video" }] }),
  ]);
  assert.match(prompt, /Question: query here/);
  assert.match(prompt, /Posts \(2\)/);
  assert.match(prompt, /permalink: https:\/\/x\.com\/alice\/status\/111/);
  assert.match(prompt, /permalink: https:\/\/x\.com\/bob\/status\/222/);
  assert.match(prompt, /media: video/);
});

test("buildCandidatePrompt truncates very long post text", () => {
  const prompt = buildCandidatePrompt("q", [tweet({ text: "x".repeat(1200) })]);
  assert.ok(prompt.includes("…"));
  assert.ok(prompt.length < 1200);
});

test("statusId and extractUrls handle real-world link shapes", () => {
  assert.equal(statusId("https://x.com/a/status/111/photo/1"), "111");
  assert.equal(statusId("https://x.com/a"), undefined);
  assert.deepEqual(extractUrls("see https://x.com/a/status/1 and https://x.com/b/status/2."), [
    "https://x.com/a/status/1",
    "https://x.com/b/status/2",
  ]);
  assert.deepEqual(extractUrls("(https://x.com/a/status/1)"), ["https://x.com/a/status/1"]);
  assert.deepEqual(extractUrls("no links here"), []);
});

test("deriveCitations matches twitter.com, query strings and media suffixes", () => {
  const candidates = [
    tweet({ url: "https://x.com/alice/status/111" }),
    tweet({ id: "2", url: "https://x.com/bob/status/222" }),
  ];
  const answer = [
    "One (https://twitter.com/alice/status/111).",
    "Two (https://x.com/bob/status/222?s=20).",
    "One again (https://x.com/alice/status/111/photo/1).",
  ].join(" ");

  const { citations, fabricated } = deriveCitations(answer, candidates);
  assert.deepEqual(citations, ["https://x.com/alice/status/111", "https://x.com/bob/status/222"]);
  assert.deepEqual(fabricated, []);
});

test("deriveCitations flags invented links without listing them", () => {
  const { citations, fabricated } = deriveCitations("Real (https://x.com/alice/status/111) fake (https://x.com/nobody/status/999).", [
    tweet({ url: "https://x.com/alice/status/111" }),
  ]);
  assert.deepEqual(citations, ["https://x.com/alice/status/111"]);
  assert.deepEqual(fabricated, ["https://x.com/nobody/status/999"]);
});

test("synthesizeAnswer returns contract details with citations", async () => {
  const details = await synthesizeAnswer({ query: "q", tweets: [tweet()], config: CONFIG, model: MODEL, deps: deps() });
  assert.equal(details.model, "anthropic/claude-haiku");
  assert.deepEqual(details.citations, ["https://x.com/alice/status/111"]);
  assert.equal(details.xSearchCalls, 1);
});

test("synthesizeAnswer short-circuits on zero posts without calling the model", async () => {
  let called = 0;
  const details = await synthesizeAnswer({
    query: "q",
    tweets: [],
    config: CONFIG,
    model: MODEL,
    deps: deps({ complete: async () => { called += 1; return "unused"; } }),
  });
  assert.equal(called, 0);
  assert.deepEqual(details.citations, []);
  assert.match(details.text, /No posts matched/);
});

test("synthesizeAnswer lists retrieved posts when the model cites nothing", async () => {
  const details = await synthesizeAnswer({
    query: "q",
    tweets: [tweet(), tweet({ id: "2", url: "https://x.com/bob/status/222" })],
    config: CONFIG,
    model: MODEL,
    deps: deps({ complete: async () => "No inline citations, plus https://x.com/fake/status/999" }),
  });
  assert.deepEqual(details.citations, ["https://x.com/alice/status/111", "https://x.com/bob/status/222"]);
  assert.ok(!details.citations.includes("https://x.com/fake/status/999"));
  assert.ok(details.notes?.some((note) => /cited no permalinks inline/.test(note)));
  assert.ok(details.notes?.some((note) => /dropped from Sources/.test(note)));
});

test("synthesizeAnswer keeps the cited subset when anything is cited", async () => {
  const details = await synthesizeAnswer({
    query: "q",
    tweets: [tweet(), tweet({ id: "2", url: "https://x.com/bob/status/222" })],
    config: CONFIG,
    model: MODEL,
    deps: deps({ complete: async () => "Only this one (https://x.com/bob/status/222)." }),
  });
  assert.deepEqual(details.citations, ["https://x.com/bob/status/222"]);
  assert.ok(!details.notes?.some((note) => /cited no permalinks inline/.test(note)));
});

test("synthesizeAnswer forwards the cancellation signal", async () => {
  const controller = new AbortController();
  let seen: AbortSignal | undefined;
  await synthesizeAnswer({
    query: "q",
    tweets: [tweet()],
    config: CONFIG,
    model: MODEL,
    signal: controller.signal,
    deps: deps({ complete: async (request) => { seen = request.signal; return "ok"; } }),
  });
  assert.equal(seen, controller.signal);
});

test("toBase64 encodes every padding case", () => {
  const encoder = new TextEncoder();
  assert.equal(toBase64(encoder.encode("")), "");
  assert.equal(toBase64(encoder.encode("f")), "Zg==");
  assert.equal(toBase64(encoder.encode("fo")), "Zm8=");
  assert.equal(toBase64(encoder.encode("foo")), "Zm9v");
  assert.equal(toBase64(new Uint8Array([0, 255, 128])), "AP+A");
});

const IMAGE_CONFIG = loadXSearchConfig({
  xsearch: { enableImageUnderstanding: true, enableVideoUnderstanding: true },
});
const VISION_MODEL: SynthesisModel = { provider: "anthropic", id: "vision", supportsImage: true };
const imageTweet = tweet({
  media: [
    { type: "photo", url: "https://pbs.twimg.com/photo.jpg" },
    { type: "video", url: "https://pbs.twimg.com/poster.jpg", videoVariants: ["https://video.twimg.com/x.mp4"] },
  ],
});

test("collectMedia attaches photos and video posters when the model accepts images", async () => {
  const fetched: string[] = [];
  const result = await collectMedia([imageTweet], IMAGE_CONFIG, VISION_MODEL, {
    complete: async () => "",
    fetchMedia: async (url): Promise<ImageAttachment | undefined> => {
      fetched.push(url);
      return { data: "AAAA", mimeType: "image/jpeg" };
    },
  });
  assert.deepEqual(fetched, ["https://pbs.twimg.com/photo.jpg", "https://pbs.twimg.com/poster.jpg"]);
  assert.equal(result.images.length, 2);
  assert.ok(result.notes.some((note) => /poster frame only/.test(note)));
});

test("collectMedia discloses media it cannot use", async () => {
  const textOnly = await collectMedia([imageTweet], IMAGE_CONFIG, MODEL, { complete: async () => "" });
  assert.equal(textOnly.images.length, 0);
  assert.ok(textOnly.notes.some((note) => /does not accept image input/.test(note)));

  const capped = await collectMedia(
    [imageTweet],
    loadXSearchConfig({ xsearch: { enableImageUnderstanding: true, enableVideoUnderstanding: true, maxMediaPerSearch: 1 } }),
    VISION_MODEL,
    { complete: async () => "", fetchMedia: async () => ({ data: "AAAA", mimeType: "image/jpeg" }) },
  );
  assert.equal(capped.images.length, 1);
  assert.ok(capped.notes.some((note) => /cap is 1/.test(note)));

  const failed = await collectMedia([imageTweet], IMAGE_CONFIG, VISION_MODEL, {
    complete: async () => "",
    fetchMedia: async () => undefined,
  });
  assert.equal(failed.images.length, 0);
  assert.ok(failed.notes.some((note) => /could not be downloaded/.test(note)));
});

test("collectMedia does no work while understanding is disabled", async () => {
  let calls = 0;
  const result = await collectMedia([imageTweet], CONFIG, MODEL, {
    complete: async () => "",
    fetchMedia: async () => { calls += 1; return { data: "A", mimeType: "image/jpeg" }; },
  });
  assert.equal(calls, 0);
  assert.deepEqual(result.images, []);
  assert.deepEqual(result.notes, []);
});

test("a look-alike URL on another host is never matched to a retrieved post", () => {
  const candidates = [tweet({ url: "https://x.com/alice/status/111" })];

  // Same path and status id, different host: must not resolve to the candidate.
  const hostile = deriveCitations("Claim (https://example.org/status/111).", candidates);
  assert.deepEqual(hostile.citations, []);
  assert.equal(statusId("https://example.org/status/111"), undefined);
  assert.equal(statusId("https://evil-x.com/status/111"), undefined);
  assert.equal(statusId("https://x.com.evil.test/status/111"), undefined);
  // Genuine X/Twitter hosts still resolve, including subdomains.
  assert.equal(statusId("https://mobile.twitter.com/alice/status/111"), "111");

  // And the tool still honours contract parity without publishing the look-alike.
  return synthesizeAnswer({ query: "q", tweets: candidates, config: CONFIG, model: MODEL, deps: deps({ complete: async () => "Claim (https://example.org/status/111)." }) }).then(
    (details) => {
      assert.ok(!details.citations.includes("https://example.org/status/111"));
      assert.deepEqual(details.citations, ["https://x.com/alice/status/111"]);
    },
  );
});

test("attachments carry a manifest tying each image to its post", async () => {
  let seenManifest: string | undefined;
  let seenImages = 0;
  const details = await synthesizeAnswer({
    query: "q",
    tweets: [imageTweet, tweet({ id: "9", url: "https://x.com/bob/status/999", text: "no media" })],
    config: IMAGE_CONFIG,
    model: VISION_MODEL,
    deps: {
      complete: async (request) => {
        seenManifest = request.mediaManifest;
        seenImages = request.images.length;
        return "ok";
      },
      fetchMedia: async () => ({ data: "AAAA", mimeType: "image/jpeg" }),
    },
  });
  assert.equal(seenImages, 2);
  assert.ok(seenManifest, "images must be accompanied by an ordered manifest");
  assert.match(seenManifest!, /1\. https:\/\/x\.com\/alice\/status\/111 — photo/);
  assert.match(seenManifest!, /2\. https:\/\/x\.com\/alice\/status\/111 — video/);
  // The model cited nothing, so contract parity lists both retrieved posts.
  assert.deepEqual(details.citations, ["https://x.com/alice/status/111", "https://x.com/bob/status/999"]);
});

test("collectMedia labels are aligned with the attachments it returns", async () => {
  const result = await collectMedia([imageTweet], IMAGE_CONFIG, VISION_MODEL, {
    complete: async () => "",
    fetchMedia: async () => ({ data: "AAAA", mimeType: "image/jpeg" }),
  });
  assert.equal(result.images.length, result.labels.length);
  assert.equal(result.labels[0], "https://x.com/alice/status/111 — photo");
});

// ------------------------------------------- citation paths and media budgeting

test("statusId matches only real status paths", () => {
  assert.equal(statusId("https://x.com/alice/status/111"), "111");
  assert.equal(statusId("https://twitter.com/alice/statuses/111"), "111");
  assert.equal(statusId("https://mobile.twitter.com/alice/status/111/photo/1"), "111", "real permalink suffixes still resolve");
  assert.equal(statusId("https://x.com/search?q=/status/111"), undefined, "a query string is not a permalink");
  assert.equal(statusId("https://x.com/alice#/status/222"), undefined, "a fragment is not a permalink");
  assert.equal(statusId("https://x.com/alice/status/111garbage"), undefined, "a digit run must end the path segment");
  assert.equal(statusId("https://x.com/alice/status/abc"), undefined);
  assert.equal(statusId("not a url"), undefined);
});

test("bounds media download attempts so a media-heavy topic cannot stall the call", async () => {
  const mediaPost = (i: number) =>
    tweet({
      id: String(i),
      url: `https://x.com/a/status/${i}`,
      media: [1, 2, 3, 4].map((n) => ({ type: "photo", url: `https://pbs.twimg.com/${i}-${n}.jpg` })),
    });
  const tweets = Array.from({ length: 50 }, (_, i) => mediaPost(i + 100));
  const config = loadXSearchConfig({ xsearch: { enableImageUnderstanding: true, maxMediaPerSearch: 4 } });
  let attempts = 0;
  const result = await collectMedia(tweets, config, VISION_MODEL, {
    complete: async () => "",
    // Every download fails, so `images` never grows and only the attempt bound
    // stops the loop — 200 downloads would otherwise be attempted here.
    fetchMedia: async () => { attempts += 1; return undefined; },
  });
  assert.equal(result.images.length, 0);
  assert.equal(attempts, 12, "attempts are bounded to 3x the attachment cap");
  assert.ok(result.notes.some((n) => /were not attempted/.test(n)), "the skipped work is disclosed");
});

test("a media-phase deadline stops further downloads", async () => {
  const mediaPost = (i: number) =>
    tweet({
      id: String(i),
      url: `https://x.com/a/status/${i}`,
      media: [{ type: "photo", url: `https://pbs.twimg.com/${i}.jpg` }],
    });
  const tweets = Array.from({ length: 20 }, (_, i) => mediaPost(i + 1));
  const config = loadXSearchConfig({ xsearch: { enableImageUnderstanding: true, maxMediaPerSearch: 20 } });
  let attempts = 0;
  const result = await collectMedia(tweets, config, VISION_MODEL, {
    complete: async () => "",
    fetchMedia: async () => { attempts += 1; return undefined; },
    mediaBudgetMs: 0,
  });
  assert.equal(attempts, 0, "an exhausted media budget means no further downloads are attempted");
  assert.equal(result.notes.some((n) => /were not attempted/.test(n)), true);
});

// ------------------------------------------------------------ account search

const USER = { handle: "grok", name: "Grok", bio: "@grok it", followers: 9_119_929, verified: true, profileUrl: "https://x.com/grok" };

test("buildUserCandidatePrompt lists the handle, metrics and profile URL", () => {
  const prompt = buildUserCandidatePrompt("who builds grok", [USER]);
  assert.match(prompt, /@grok/);
  assert.match(prompt, /9119929 followers/);
  assert.match(prompt, /verified/);
  assert.match(prompt, /profile: https:\/\/x\.com\/grok/);
});

test("deriveUserCitations publishes only retrieved profiles", () => {
  const cited = deriveUserCitations("Built by (https://x.com/grok).", [USER]);
  assert.deepEqual(cited.citations, ["https://x.com/grok"]);

  // Same handle on another host is not the account we fetched.
  assert.deepEqual(deriveUserCitations("See (https://example.org/grok).", [USER]).citations, []);

  // A profile we did not retrieve is disclosed rather than published.
  const other = deriveUserCitations("See (https://x.com/someoneelse).", [USER]);
  assert.deepEqual(other.citations, []);
  assert.equal(other.fabricated.length, 1);
});

test("an account answer with no inline citation falls back to the retrieved profiles", async () => {
  const details = await synthesizeUserAnswer({
    query: "grok accounts",
    users: [USER],
    config: IMAGE_CONFIG,
    model: VISION_MODEL,
    deps: { complete: async () => "No links here." },
  });
  assert.deepEqual(details.citations, ["https://x.com/grok"], "Sources still lists what was retrieved");
  assert.equal(details.xSearchCalls, 1);
  assert.ok(details.notes?.some((note: string) => /cited no profile URLs/.test(note)));

  const empty = await synthesizeUserAnswer({
    query: "nobody",
    users: [],
    config: IMAGE_CONFIG,
    model: VISION_MODEL,
    deps: { complete: async () => "unused" },
  });
  assert.equal(empty.xSearchCalls, 0, "no accounts means no synthesis call");
  assert.deepEqual(empty.citations, []);
});
