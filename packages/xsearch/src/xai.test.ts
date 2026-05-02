import assert from "node:assert/strict";
import test from "node:test";

import {
  buildXSearchRequest,
  loadXSearchConfig,
  normalizeParams,
  parseXaiResponse,
  searchX,
  type XSearchParams,
} from "./xai.js";

test("loadXSearchConfig applies defaults and top-level settings overrides", () => {
  assert.deepEqual(loadXSearchConfig({}), {
    model: "grok-4-1-fast-non-reasoning",
    enableImageUnderstanding: false,
    enableVideoUnderstanding: false,
  });
  assert.deepEqual(loadXSearchConfig({ xsearch: { model: "grok-4.20-reasoning", enableVideoUnderstanding: true } }), {
    model: "grok-4.20-reasoning",
    enableImageUnderstanding: false,
    enableVideoUnderstanding: true,
  });
});

test("normalizeParams trims query and validates handle filters", () => {
  const normalized = normalizeParams({ query: "  latest xAI  ", allowed_x_handles: ["@xai", " elonmusk "] });
  assert.deepEqual(normalized, {
    query: "latest xAI",
    allowed_x_handles: ["xai", "elonmusk"],
  });

  assert.throws(() => normalizeParams({ query: "   " }), /query must not be empty/i);
  assert.throws(
    () => normalizeParams({ query: "x", allowed_x_handles: ["xai"], excluded_x_handles: ["spam"] }),
    /cannot be set together/i,
  );
  assert.throws(() => normalizeParams({ query: "x", allowed_x_handles: Array.from({ length: 11 }, (_, i) => `h${i}`) }), /max 10/i);
});

test("normalizeParams validates date range", () => {
  assert.equal(normalizeParams({ query: "x", from_date: "2026-05-01" }).from_date, "2026-05-01");
  assert.throws(() => normalizeParams({ query: "x", from_date: "2026/05/01" }), /YYYY-MM-DD/i);
  assert.throws(() => normalizeParams({ query: "x", from_date: "2026-05-02", to_date: "2026-05-01" }), /from_date must be before/i);
});

test("buildXSearchRequest maps params and config to xAI Responses payload", () => {
  const params: XSearchParams = {
    query: "what are people saying about grok?",
    allowed_x_handles: ["xai"],
    from_date: "2026-05-01",
  };

  assert.deepEqual(buildXSearchRequest(normalizeParams(params), {
    model: "grok-4.20-reasoning",
    enableImageUnderstanding: true,
    enableVideoUnderstanding: false,
  }), {
    model: "grok-4.20-reasoning",
    input: [{ role: "user", content: "what are people saying about grok?" }],
    tools: [{
      type: "x_search",
      allowed_x_handles: ["xai"],
      from_date: "2026-05-01",
      enable_image_understanding: true,
    }],
  });
});

test("parseXaiResponse extracts answer, citations, and usage", () => {
  const parsed = parseXaiResponse({
    output: [
      { type: "x_search_call", name: "x_keyword_search" },
      {
        type: "message",
        content: [{ type: "output_text", text: "Grok answer [[1]](https://x.com/xai/status/1)", annotations: [{ type: "url_citation", url: "https://x.com/xai/status/1" }] }],
      },
    ],
    citations: ["https://x.com/xai/status/2"],
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30,
      server_side_tool_usage_details: { x_search_calls: 2, web_search_calls: 0 },
    },
  }, "query", "model");

  assert.equal(parsed.text, "Grok answer [[1]](https://x.com/xai/status/1)");
  assert.deepEqual(parsed.citations, ["https://x.com/xai/status/1", "https://x.com/xai/status/2"]);
  assert.equal(parsed.xSearchCalls, 2);
  assert.equal(parsed.inputTokens, 10);
});

test("searchX posts to xAI and redacts API key from errors", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const okFetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: "Answer" }] }],
      citations: ["https://x.com/xai/status/1"],
      usage: { server_side_tool_usage_details: { x_search_calls: 1 } },
    }), { status: 200 });
  };

  const result = await searchX({ query: "test" }, { model: "m", enableImageUnderstanding: false, enableVideoUnderstanding: false }, "secret-key", okFetcher);
  assert.equal(calls[0].url, "https://api.x.ai/v1/responses");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer secret-key");
  assert.match(result.markdown, /## Answer\n\nAnswer/);
  assert.equal(result.details.citations[0], "https://x.com/xai/status/1");

  const errorFetcher: typeof fetch = async () => new Response(JSON.stringify({ error: "bad secret-key" }), { status: 401 });
  await assert.rejects(
    () => searchX({ query: "test" }, { model: "m", enableImageUnderstanding: false, enableVideoUnderstanding: false }, "secret-key", errorFetcher),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /xAI X search failed with status 401/);
      assert.doesNotMatch(error.message, /secret-key/);
      return true;
    },
  );
});
