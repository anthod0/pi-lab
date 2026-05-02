import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExaRequest,
  normalizeParams,
  parseExaResponse,
  searchExa,
  type WebSearchParams,
} from "./exa.js";
import { formatSearchResults } from "./format.js";

test("normalizeParams applies safe defaults", () => {
  const params = normalizeParams({ query: "pi coding agent" });

  assert.deepEqual(params, {
    query: "pi coding agent",
    num_results: 5,
    type: "auto",
    fresh: false,
  });
});

test("normalizeParams trims query and rejects empty queries", () => {
  assert.equal(normalizeParams({ query: "  Exa search  " }).query, "Exa search");
  assert.throws(() => normalizeParams({ query: "   " }), /query must not be empty/i);
});

test("normalizeParams rejects num_results outside 1..20", () => {
  assert.throws(() => normalizeParams({ query: "x", num_results: 0 }), /num_results must be between 1 and 20/i);
  assert.throws(() => normalizeParams({ query: "x", num_results: 21 }), /num_results must be between 1 and 20/i);
  assert.throws(() => normalizeParams({ query: "x", num_results: 1.5 }), /num_results must be an integer/i);
});

test("buildExaRequest maps tool parameters to the supported Exa request shape", () => {
  const params: Required<Pick<WebSearchParams, "query" | "num_results" | "type" | "fresh">> & WebSearchParams = {
    query: "latest pi docs",
    num_results: 3,
    type: "deep-lite",
    category: "news",
    include_domains: ["example.com"],
    exclude_domains: ["spam.example"],
    start_published_date: "2026-01-01",
    end_published_date: "2026-05-02",
    fresh: true,
  };

  assert.deepEqual(buildExaRequest(params), {
    query: "latest pi docs",
    type: "deep-lite",
    numResults: 3,
    category: "news",
    includeDomains: ["example.com"],
    excludeDomains: ["spam.example"],
    startPublishedDate: "2026-01-01",
    endPublishedDate: "2026-05-02",
    contents: {
      highlights: true,
      maxAgeHours: 0,
    },
  });
});

test("parseExaResponse normalizes results and preserves compact raw fields", () => {
  const parsed = parseExaResponse({
    requestId: "req_123",
    autopromptString: "search prompt",
    results: [
      {
        id: "1",
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

test("formatSearchResults emits concise Markdown with highlights and fallback text", () => {
  const markdown = formatSearchResults({
    query: "exa docs",
    type: "auto",
    resultCount: 2,
    results: [
      {
        title: "Exa Docs",
        url: "https://docs.exa.ai",
        publishedDate: "2026-04-01",
        author: "Exa",
        highlights: ["Search API reference"],
      },
      {
        title: "No Highlight",
        url: "https://example.com/no-highlight",
        highlights: [],
        text: "Short fallback text that should be shown.",
      },
    ],
  });

  assert.match(markdown, /^Query: exa docs\nType: auto\nResults: 2/m);
  assert.match(markdown, /1\. Exa Docs\n   URL: https:\/\/docs\.exa\.ai\n   Published: 2026-04-01\n   Author: Exa\n   Highlights:\n   - Search API reference/);
  assert.match(markdown, /2\. No Highlight\n   URL: https:\/\/example\.com\/no-highlight\n   Text: Short fallback text that should be shown\./);
  assert.doesNotMatch(markdown, /\{/);
});

test("searchExa posts to Exa with API key and returns markdown plus details", async () => {
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
  assert.match(result.markdown, /1\. Top/);
  assert.equal(result.details.resultCount, 1);
});

test("searchExa reports non-2xx Exa errors without leaking the API key", async () => {
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
