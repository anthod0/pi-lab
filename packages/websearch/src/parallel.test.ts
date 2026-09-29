import assert from "node:assert/strict";
import test from "node:test";

import { buildParallelRequest, parseParallelResponse, searchParallel } from "./parallel.js";
import { normalizeParams } from "./search.js";

test("buildParallelRequest maps common parameters and search types", () => {
  assert.deepEqual(buildParallelRequest(normalizeParams({
    query: "latest pi docs",
    num_results: 3,
    type: "deep",
    include_domains: ["example.com"],
    exclude_domains: ["spam.example"],
    start_published_date: "2026-01-01",
  })), {
    objective: "latest pi docs",
    search_queries: ["latest pi docs"],
    mode: "advanced",
    advanced_settings: {
      max_results: 3,
      source_policy: {
        include_domains: ["example.com"],
        exclude_domains: ["spam.example"],
        after_date: "2026-01-01",
      },
      fetch_policy: { max_age_seconds: 600 },
    },
  });

  assert.equal(buildParallelRequest(normalizeParams({ query: "x", type: "fast" })).mode, "turbo");
  assert.equal(buildParallelRequest(normalizeParams({ query: "x", type: "balanced" })).mode, "fast");
});

test("parseParallelResponse normalizes excerpts and preserves response metadata", () => {
  const parsed = parseParallelResponse({
    search_id: "search_123",
    session_id: "session_123",
    usage: [{ name: "sku_search", count: 1 }],
    results: [{
      title: "Result One",
      url: "https://example.com/one",
      publish_date: "2026-05-01",
      excerpts: ["First excerpt"],
    }],
  });

  assert.deepEqual(parsed.results[0], {
    title: "Result One",
    url: "https://example.com/one",
    publishedDate: "2026-05-01",
    highlights: ["First excerpt"],
  });
  assert.deepEqual(parsed.raw, {
    searchId: "search_123",
    sessionId: "session_123",
    usage: [{ name: "sku_search", count: 1 }],
  });
});

test("searchParallel posts to the v1 API and returns normalized details", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({
      search_id: "search_123",
      session_id: "session_123",
      results: [{ title: "Top", url: "https://top.example", excerpts: ["Useful"] }],
    }), { status: 200 });
  };

  const result = await searchParallel({ query: "test", num_results: 1 }, "secret-key", fetcher);

  assert.equal(calls[0].url, "https://api.parallel.ai/v1/search");
  assert.equal((calls[0].init.headers as Record<string, string>)["x-api-key"], "secret-key");
  const request = JSON.parse(String(calls[0].init.body));
  assert.equal(request.mode, "fast");
  assert.equal(request.advanced_settings.max_results, 1);
  assert.equal(result.details.provider, "parallel");
  assert.match(result.markdown, /Provider: parallel/);
});

test("searchParallel reports nested API errors without leaking the API key", async () => {
  const fetcher: typeof fetch = async () =>
    new Response(JSON.stringify({ error: { message: "invalid secret-key" } }), { status: 401 });

  await assert.rejects(
    () => searchParallel({ query: "test" }, "secret-key", fetcher),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Parallel search failed with status 401/);
      assert.doesNotMatch(error.message, /secret-key/);
      return true;
    },
  );
});
