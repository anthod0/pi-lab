import assert from "node:assert/strict";
import test from "node:test";

import { registerWebSearchTool } from "./tool.js";

interface RegisteredTool {
  name: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  execute: (
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: { cwd: string; isProjectTrusted(): boolean },
  ) => Promise<{ content: Array<{ type: "text"; text: string }>; details: unknown }>;
}

const context = { cwd: process.cwd(), isProjectTrusted: () => false };

test("registerWebSearchTool relies on the tool description without extra prompt injection", () => {
  let registered: RegisteredTool | undefined;
  const pi = { registerTool(tool: RegisteredTool) { registered = tool; } };

  registerWebSearchTool(pi as never, { provider: "exa", env: { EXA_API_KEY: "key" } });

  assert.equal(registered?.name, "websearch");
  assert.equal(registered?.description, "Search the web and return concise, citation-friendly results.");
  assert.equal(registered?.promptSnippet, undefined);
  assert.equal(registered?.promptGuidelines, undefined);
});

test("websearch execution requires the selected provider API key", async () => {
  let registered: RegisteredTool | undefined;
  const pi = { registerTool(tool: RegisteredTool) { registered = tool; } };

  registerWebSearchTool(pi as never, { provider: "parallel", env: {} });

  await assert.rejects(
    () => registered!.execute("call-1", { query: "test" }, undefined, undefined, context),
    /PARALLEL_API_KEY must be configured/,
  );
});

test("websearch routes execution to Parallel", async () => {
  let registered: RegisteredTool | undefined;
  const pi = { registerTool(tool: RegisteredTool) { registered = tool; } };
  const fetcher: typeof fetch = async (url) => {
    assert.equal(String(url), "https://api.parallel.ai/v1/search");
    return new Response(JSON.stringify({
      search_id: "search_123",
      session_id: "session_123",
      results: [{ title: "Top", url: "https://top.example", excerpts: ["Useful"] }],
    }), { status: 200 });
  };

  registerWebSearchTool(pi as never, {
    provider: "parallel",
    env: { PARALLEL_API_KEY: "key" },
    fetcher,
  });
  const result = await registered!.execute("call-1", { query: "test", num_results: 1 }, undefined, undefined, context);

  assert.match(result.content[0].text, /Provider: parallel/);
  assert.equal((result.details as { resultCount: number }).resultCount, 1);
});

test("websearch routes execution to TinyFish", async () => {
  let registered: RegisteredTool | undefined;
  const pi = { registerTool(tool: RegisteredTool) { registered = tool; } };
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(new URL(String(url)).origin, "https://api.search.tinyfish.ai");
    assert.equal((init?.headers as Record<string, string>)["X-API-Key"], "key");
    return new Response(JSON.stringify({
      query: "test",
      total_results: 1,
      page: 0,
      results: [{ title: "Top", url: "https://top.example", snippet: "Useful" }],
    }), { status: 200 });
  };

  registerWebSearchTool(pi as never, {
    provider: "tinyfish",
    env: { TINYFISH_API_KEY: "key" },
    fetcher,
  });
  const result = await registered!.execute("call-1", { query: "test", num_results: 1 }, undefined, undefined, context);

  assert.match(result.content[0].text, /Provider: tinyfish/);
  assert.equal((result.details as { resultCount: number }).resultCount, 1);
});
