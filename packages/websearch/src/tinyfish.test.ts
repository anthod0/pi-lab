import assert from "node:assert/strict";
import test from "node:test";

import { buildTinyfishRequest, parseTinyfishResponse, searchTinyfish } from "./tinyfish.js";
import { normalizeParams } from "./search.js";

test("buildTinyfishRequest maps supported common parameters and ignores unsupported ones", () => {
  assert.deepEqual(buildTinyfishRequest(normalizeParams({
    query: "latest pi docs",
    num_results: 3,
    type: "deep",
    include_domains: ["example.com", "docs.example.com"],
    exclude_domains: ["spam.example"],
    start_published_date: "2026-01-01T12:30:00Z",
  })), {
    query: "latest pi docs",
    include_domains: "example.com,docs.example.com",
    exclude_domains: "spam.example",
    after_date: "2026-01-01",
    page: 0,
  });
});

test("parseTinyfishResponse normalizes snippets and metadata", () => {
  const parsed = parseTinyfishResponse({
    query: "pi docs",
    total_results: 1,
    page: 0,
    results: [{
      title: "Result One",
      url: "https://example.com/one",
      snippet: "First excerpt",
      date: "2026-05-01",
      publisher: "Example",
    }],
  });

  assert.deepEqual(parsed.results[0], {
    title: "Result One",
    url: "https://example.com/one",
    publishedDate: "2026-05-01",
    author: "Example",
    highlights: ["First excerpt"],
  });
  assert.deepEqual(parsed.raw, { totalResults: 1, page: 0 });
});

test("searchTinyfish uses GET, paginates, and returns only the requested results", async () => {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init: init ?? {} });
    const page = Number(url.searchParams.get("page"));
    const count = page === 0 ? 10 : 5;
    return new Response(JSON.stringify({
      query: "test",
      total_results: count,
      page,
      results: Array.from({ length: count }, (_, index) => ({
        title: `Result ${page * 10 + index + 1}`,
        url: `https://example.com/${page * 10 + index + 1}`,
        snippet: "Useful",
      })),
    }), { status: 200 });
  };

  const result = await searchTinyfish({ query: "test", num_results: 12, type: "deep" }, "secret-key", fetcher);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.origin + calls[0].url.pathname, "https://api.search.tinyfish.ai/");
  assert.equal(calls[0].init.method, "GET");
  assert.equal((calls[0].init.headers as Record<string, string>)["X-API-Key"], "secret-key");
  assert.equal(calls[1].url.searchParams.get("page"), "1");
  assert.equal(result.details.resultCount, 12);
  assert.equal(result.details.provider, "tinyfish");
  assert.match(result.markdown, /Provider: tinyfish/);
});

test("searchTinyfish reports API errors without leaking the API key", async () => {
  const fetcher: typeof fetch = async () =>
    new Response(JSON.stringify({ error: "invalid secret-key" }), { status: 401 });

  await assert.rejects(
    () => searchTinyfish({ query: "test" }, "secret-key", fetcher),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /TinyFish search failed with status 401/);
      assert.doesNotMatch(error.message, /secret-key/);
      return true;
    },
  );
});
