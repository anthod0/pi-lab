import assert from "node:assert/strict";
import test from "node:test";

import { buildExaRequest, parseExaResponse, searchExa } from "./exa.js";
import { formatSearchResults } from "./format.js";
import { normalizeParams } from "./search.js";

test("normalizeParams applies provider-neutral defaults", () => {
  const params = normalizeParams({ query: "pi coding agent" });

  assert.deepEqual(params, {
    query: "pi coding agent",
    num_results: 5,
    type: "balanced",
  });
});

test("normalizeParams trims query and validates result counts", () => {
  assert.equal(normalizeParams({ query: "  Exa search  " }).query, "Exa search");
  assert.throws(() => normalizeParams({ query: "   " }), /query must not be empty/i);
  assert.throws(() => normalizeParams({ query: "x", num_results: 0 }), /num_results must be between 1 and 20/i);
  assert.throws(() => normalizeParams({ query: "x", num_results: 21 }), /num_results must be between 1 and 20/i);
  assert.throws(() => normalizeParams({ query: "x", num_results: 1.5 }), /num_results must be an integer/i);
});

test("buildExaRequest maps common parameters and search types", () => {
  assert.deepEqual(buildExaRequest(normalizeParams({
    query: "latest pi docs",
    num_results: 3,
    type: "deep",
    include_domains: ["example.com"],
    exclude_domains: ["spam.example"],
    start_published_date: "2026-01-01",
  })), {
    query: "latest pi docs",
    type: "deep",
    numResults: 3,
    includeDomains: ["example.com"],
    excludeDomains: ["spam.example"],
    startPublishedDate: "2026-01-01",
    contents: {
      highlights: true,
      maxAgeHours: 0,
    },
  });

  assert.equal(buildExaRequest(normalizeParams({ query: "x", type: "fast" })).type, "instant");
  assert.equal(buildExaRequest(normalizeParams({ query: "x", type: "balanced" })).type, "auto");
});

test("parseExaResponse normalizes results and preserves compact raw fields", () => {
  const parsed = parseExaResponse({
    requestId: "req_123",
    autopromptString: "search prompt",
    results: [
      {
        title: "Result One",
        url: "https://example.com/one",
        publishedDate: "2026-05-01",
        author: "Ada",
        highlights: ["First highlight", "Second highlight"],
        text: "Fallback text",
      },
    ],
  });

  assert.equal(parsed.resultCount, 1);
  assert.deepEqual(parsed.raw, { requestId: "req_123", autopromptString: "search prompt" });
  assert.deepEqual(parsed.results[0], {
    title: "Result One",
    url: "https://example.com/one",
    publishedDate: "2026-05-01",
    author: "Ada",
    highlights: ["First highlight", "Second highlight"],
    text: "Fallback text",
  });
});

test("formatSearchResults emits concise Markdown with provider and highlights", () => {
  const markdown = formatSearchResults({
    provider: "exa",
    query: "exa docs",
    type: "balanced",
    resultCount: 1,
    results: [{
      title: "Exa Docs",
      url: "https://docs.exa.ai",
      publishedDate: "2026-04-01",
      author: "Exa",
      highlights: ["Search API reference"],
    }],
  });

  assert.match(markdown, /^Query: exa docs\nProvider: exa\nType: balanced\nResults: 1/m);
  assert.match(markdown, /1\. Exa Docs\n   URL: https:\/\/docs\.exa\.ai/);
  assert.doesNotMatch(markdown, /\{/);
});

test("searchExa posts to Exa and returns normalized details", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ results: [{ title: "Top", url: "https://top.example", highlights: ["Useful"] }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await searchExa({ query: "test", num_results: 1 }, "secret-key", fetcher);

  assert.equal(calls[0].url, "https://api.exa.ai/search");
  assert.equal((calls[0].init.headers as Record<string, string>)["x-api-key"], "secret-key");
  assert.equal(JSON.parse(String(calls[0].init.body)).numResults, 1);
  assert.match(result.markdown, /Provider: exa/);
  assert.equal(result.details.provider, "exa");
});

test("searchExa reports non-2xx errors without leaking the API key", async () => {
  const fetcher: typeof fetch = async () =>
    new Response(JSON.stringify({ error: "invalid api key secret-key" }), { status: 401 });

  await assert.rejects(
    () => searchExa({ query: "test" }, "secret-key", fetcher),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Exa search failed with status 401/);
      assert.doesNotMatch(error.message, /secret-key/);
      return true;
    },
  );
});
