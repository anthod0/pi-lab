import assert from "node:assert/strict";
import test from "node:test";

import { assistantText, completionText, createFetchMedia, resolveModel, runTwitterApiSearch, runTwitterApiUserSearch, selectBackend, toSynthesisModel, type RegistryLike } from "./backend.js";
import { loadXSearchConfig } from "./config.js";

function registry(models: Array<{ provider: string; id: string; input?: string[] }>): RegistryLike {
  return {
    find: (provider, id) => models.find((model) => model.provider === provider && model.id === id),
    getAll: () => models,
    complete: async () => ({}),
  };
}

test("selectBackend prefers xAI, then twitterapi.io, and honours an explicit setting", () => {
  const auto = loadXSearchConfig({});
  assert.equal(selectBackend(auto, {}), undefined);
  assert.equal(selectBackend(auto, { XAI_API_KEY: "k" }), "xai");
  assert.equal(selectBackend(auto, { TWITTERAPI_IO_API_KEY: "k" }), "twitterapi");
  assert.equal(selectBackend(auto, { XAI_API_KEY: "a", TWITTERAPI_IO_API_KEY: "b" }), "xai");

  const pinnedXai = loadXSearchConfig({ xsearch: { backend: "xai" } });
  assert.equal(selectBackend(pinnedXai, { TWITTERAPI_IO_API_KEY: "b" }), undefined);
  assert.equal(selectBackend(pinnedXai, { XAI_API_KEY: "a", TWITTERAPI_IO_API_KEY: "b" }), "xai");

  const pinnedTwitter = loadXSearchConfig({ xsearch: { backend: "twitterapi" } });
  assert.equal(selectBackend(pinnedTwitter, { XAI_API_KEY: "a" }), undefined);
  assert.equal(selectBackend(pinnedTwitter, { XAI_API_KEY: "a", TWITTERAPI_IO_API_KEY: "b" }), "twitterapi");
});

test("resolveModel accepts provider/model and bare ids", () => {
  const models = registry([
    { provider: "anthropic", id: "claude-haiku", input: ["text", "image"] },
    { provider: "openai", id: "gpt", input: ["text"] },
  ]);
  assert.equal(resolveModel(models, "anthropic/claude-haiku")?.provider, "anthropic");
  assert.equal(resolveModel(models, "gpt")?.provider, "openai");
  assert.equal(resolveModel(models, "anthropic/missing"), undefined);
  assert.equal(resolveModel(models, "missing"), undefined);
});

test("resolveModel falls back to a scan when find() does not know the pair", () => {
  const models = registry([{ provider: "custom", id: "thing" }]);
  const sparse: RegistryLike = { find: () => undefined, getAll: models.getAll, complete: models.complete };
  assert.equal(resolveModel(sparse, "custom/thing")?.id, "thing");
});

test("resolveModel rejects an ambiguous bare id and points at provider/model", () => {
  const models = registry([
    { provider: "a", id: "same" },
    { provider: "b", id: "same" },
  ]);
  assert.throws(() => resolveModel(models, "same"), /ambiguous across providers \(a, b\)/);
});

test("a provider-qualified short form resolves to a namespaced model id", () => {
  // Command Code exposes `deepseek/deepseek-v4.1-flash` as the model id under
  // provider `commandcode`, and pi's own --model accepts `commandcode/deepseek-v4.1-flash`.
  const models = registry([
    { provider: "commandcode", id: "deepseek/deepseek-v4.1-flash" },
    { provider: "commandcode", id: "deepseek/deepseek-v4-flash" },
    { provider: "anthropic", id: "claude-haiku" },
  ]);

  assert.equal(resolveModel(models, "commandcode/deepseek-v4.1-flash")?.id, "deepseek/deepseek-v4.1-flash");
  assert.equal(resolveModel(models, "commandcode/deepseek/deepseek-v4.1-flash")?.id, "deepseek/deepseek-v4.1-flash");
  assert.equal(resolveModel(models, "deepseek-v4.1-flash")?.id, "deepseek/deepseek-v4.1-flash");
  // The shorter sibling must not be swallowed by the longer one's suffix.
  assert.equal(resolveModel(models, "commandcode/deepseek-v4-flash")?.id, "deepseek/deepseek-v4-flash");
  assert.equal(resolveModel(models, "commandcode/deepseek-v5"), undefined);
  assert.equal(resolveModel(models, "other/deepseek-v4.1-flash"), undefined, "another provider must not match");
});

test("an ambiguous short form is rejected with its candidates", () => {
  const models = registry([
    { provider: "commandcode", id: "vendor/deepseek-v4.1-flash" },
    { provider: "commandcode", id: "other/deepseek-v4.1-flash" },
  ]);
  assert.throws(() => resolveModel(models, "commandcode/deepseek-v4.1-flash"), /matches several models/);
});

test("a missing synthesis model reports what is actually available", async () => {
  const config = loadXSearchConfig({ xsearch: { synthesisModel: "commandcode/nope" } });
  const neverCalled = (async () => {
    throw new Error("no request may be made");
  }) as unknown as typeof fetch;
  await assert.rejects(
    () =>
      runTwitterApiUserSearch({
        query: "x",
        config,
        env: { TWITTERAPI_IO_API_KEY: "k" },
        fetcher: neverCalled,
        registry: registry([{ provider: "commandcode", id: "deepseek/deepseek-v4.1-flash" }]),
      }),
    /Known models for "commandcode": commandcode\/deepseek\/deepseek-v4\.1-flash/,
  );
});

test("toSynthesisModel reports image support from the model input list", () => {
  assert.equal(toSynthesisModel({ provider: "anthropic", id: "vision", input: ["text", "image"] }).supportsImage, true);
  assert.equal(toSynthesisModel({ provider: "openai", id: "text-only", input: ["text"] }).supportsImage, false);
  assert.equal(toSynthesisModel({ provider: "openai", id: "unknown" }).supportsImage, false);
});

test("assistantText joins text blocks and ignores everything else", () => {
  assert.equal(
    assistantText({
      content: [
        { type: "text", text: "first" },
        { type: "thinking", thinking: "hidden" },
        { type: "text", text: "second" },
      ],
    }),
    "first\nsecond",
  );
  assert.equal(assistantText({ content: "not-an-array" }), "");
  assert.equal(assistantText(null), "");
  assert.equal(assistantText(undefined), "");
});

// ------------------------------------------------------- media download gates

function imageResponse(body: BodyInit, headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers: { "content-type": "image/jpeg", ...headers } });
}

test("createFetchMedia rejects non-image and declared-oversized responses before reading", async () => {
  let readAttempts = 0;
  const probe = (response: Response) => {
    const original = response.body?.getReader.bind(response.body);
    if (!original) return response;
    Object.defineProperty(response, "body", {
      get() {
        return {
          getReader: () => {
            readAttempts += 1;
            return original();
          },
        };
      },
    });
    return response;
  };

  const fetcher = (async (url: string) =>
    probe(
      String(url).includes("html")
        ? new Response("<html>not an image</html>", { status: 200, headers: { "content-type": "text/html" } })
        : imageResponse("x", { "content-length": "999999999" }),
    )) as unknown as typeof fetch;

  const fetchMedia = createFetchMedia(fetcher, undefined, { maxBytes: 16 });
  assert.equal(await fetchMedia("https://pbs.twimg.com/html"), undefined);
  assert.equal(await fetchMedia("https://pbs.twimg.com/huge.jpg"), undefined);
  assert.equal(readAttempts, 0, "body must not be read for rejected responses");
});

test("createFetchMedia enforces the byte cap while streaming rather than after buffering", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < 5; i += 1) controller.enqueue(new Uint8Array(8)); // 40 bytes total
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const fetcher = (async () => new Response(stream, { status: 200, headers: { "content-type": "image/jpeg" } })) as unknown as typeof fetch;

  const fetchMedia = createFetchMedia(fetcher, undefined, { maxBytes: 16 });
  assert.equal(await fetchMedia("https://pbs.twimg.com/big.jpg"), undefined);
  assert.equal(cancelled, true, "an over-cap stream must be cancelled, not drained");

  const okStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
  const okFetcher = (async () => new Response(okStream, { status: 200, headers: { "content-type": "image/png" } })) as unknown as typeof fetch;
  const result = await createFetchMedia(okFetcher, undefined, { maxBytes: 16 })("https://pbs.twimg.com/small.png");
  assert.equal(result?.mimeType, "image/png");
  assert.equal(result?.data, "AQID");
});

test("createFetchMedia honours its deadline and the caller's cancellation", async () => {
  const stalled = (async (_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })) as unknown as typeof fetch;

  const timedOut = await createFetchMedia(stalled, undefined, { timeoutMs: 15 })("https://pbs.twimg.com/stall.jpg");
  assert.equal(timedOut, undefined, "a stalled download must give up on its own deadline");

  const controller = new AbortController();
  controller.abort();
  const preAborted = await createFetchMedia(stalled, controller.signal, { timeoutMs: 5_000 })("https://pbs.twimg.com/x.jpg");
  assert.equal(preAborted, undefined, "an aborted caller must not download at all");

  const live = new AbortController();
  const started = Date.now();
  const pending = createFetchMedia(stalled, live.signal, { timeoutMs: 30_000 })("https://pbs.twimg.com/y.jpg");
  setTimeout(() => live.abort(), 15);
  assert.equal(await pending, undefined);
  assert.ok(Date.now() - started < 5_000, "caller cancellation must end the download promptly");
});

test("completionText rejects failed, aborted, tool-calling, and empty completions", () => {
  assert.equal(completionText({ stopReason: "stop", content: [{ type: "text", text: "ok" }] }), "ok");
  // The provider reports failure but still resolves: this must not become an
  // empty-but-successful answer.
  assert.throws(
    () => completionText({ stopReason: "error", errorMessage: "quota exceeded", content: [] }),
    /xsearch synthesis failed: quota exceeded/,
  );
  assert.throws(() => completionText({ stopReason: "aborted", content: [] }), /cancelled/);
  assert.throws(() => completionText({ stopReason: "toolUse", content: [] }), /call a tool/);
  assert.throws(() => completionText({ stopReason: "length", content: [] }), /output limit/);
  assert.throws(() => completionText({ stopReason: "stop", content: [] }), /empty answer/);
  assert.throws(() => completionText({ content: [] }), /empty answer/);
  assert.throws(() => completionText(undefined), /empty answer/);
  // A truncated-but-non-empty answer is still usable.
  assert.equal(completionText({ stopReason: "length", content: [{ type: "text", text: "partial" }] }), "partial");
});

test("notes the pages spent trimming out-of-window posts", async () => {
  const config = loadXSearchConfig({ xsearch: { synthesisModel: "anthropic/haiku", minRequestIntervalMs: 0 } });
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    const createdAt = calls === 1 ? "Fri Sep 25 23:00:00 +0000 2026" : "Fri Sep 25 12:00:00 +0000 2026";
    return new Response(
      JSON.stringify({
        tweets: [{ id: String(calls), url: `https://x.com/a/status/${calls}`, text: "hi", createdAt, author: { userName: "a" } }],
        has_next_page: calls < 2,
        next_cursor: `c${calls}`,
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const reg = registry([{ provider: "anthropic", id: "haiku", input: ["text"] }]);
  reg.complete = async () => ({ content: [{ type: "text", text: "cited (https://x.com/a/status/2)" }] });

  const { details, markdown } = await runTwitterApiSearch({
    params: { query: "x", count: 1, from_date: "2026-09-25", to_date: "2026-09-25" },
    config,
    env: { TWITTERAPI_IO_API_KEY: "k" },
    fetcher,
    registry: reg,
    localUtcOffsetMinutes: 120,
  });

  assert.ok(details.notes?.some((n) => /outside the requested local window/.test(n)), "the trimming is disclosed");
  assert.match(markdown, /## Notes/);
  assert.match(markdown, /6h past local midnight/, "the note names the actual band size");
});

test("an explicit invalid page budget is rejected rather than clamped into validity", async () => {
  const config = loadXSearchConfig({ xsearch: { synthesisModel: "anthropic/haiku", maxPages: 5, maxPagesCeiling: 10 } });
  const neverCalled = (async () => {
    throw new Error("no request may be made with an invalid budget");
  }) as unknown as typeof fetch;

  for (const bad of [Number.POSITIVE_INFINITY, 20.5, 0, -1, Number.NaN]) {
    await assert.rejects(
      () =>
        runTwitterApiUserSearch({
          query: "x",
          config,
          env: { TWITTERAPI_IO_API_KEY: "k" },
          fetcher: neverCalled,
          registry: registry([{ provider: "anthropic", id: "haiku", input: ["text"] }]),
          maxPages: bad,
        }),
      /maxPages must be a positive integer/,
      `${String(bad)} must be rejected`,
    );
  }
});
