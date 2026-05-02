import assert from "node:assert/strict";
import test from "node:test";

import { registerWebSearchTool } from "./tool.js";

interface RegisteredTool {
  name: string;
  promptGuidelines: string[];
  execute: (toolCallId: string, params: unknown) => Promise<{ content: Array<{ type: "text"; text: string }>; details: unknown }>;
}

test("registerWebSearchTool registers websearch with prompt guidance", () => {
  let registered: RegisteredTool | undefined;
  const pi = { registerTool(tool: RegisteredTool) { registered = tool; } };

  registerWebSearchTool(pi as never, { env: { EXA_API_KEY: "key" } });

  assert.equal(registered?.name, "websearch");
  assert.ok(registered.promptGuidelines.some((line) => line.includes("current or external information")));
});

test("websearch execution requires EXA_API_KEY", async () => {
  let registered: RegisteredTool | undefined;
  const pi = { registerTool(tool: RegisteredTool) { registered = tool; } };

  registerWebSearchTool(pi as never, { env: {} });

  await assert.rejects(
    () => registered!.execute("call-1", { query: "test" }),
    /EXA_API_KEY must be configured/,
  );
});

test("websearch execution returns formatted content and structured details", async () => {
  let registered: RegisteredTool | undefined;
  const pi = { registerTool(tool: RegisteredTool) { registered = tool; } };
  const fetcher: typeof fetch = async () =>
    new Response(JSON.stringify({ results: [{ title: "Top", url: "https://top.example", highlights: ["Useful"] }] }), {
      status: 200,
    });

  registerWebSearchTool(pi as never, { env: { EXA_API_KEY: "key" }, fetcher });
  const result = await registered!.execute("call-1", { query: "test", num_results: 1 });

  assert.match(result.content[0].text, /Query: test/);
  assert.equal((result.details as { resultCount: number }).resultCount, 1);
});
