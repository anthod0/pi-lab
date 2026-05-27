import assert from "node:assert/strict";
import test from "node:test";

import { registerGrokBuildTool } from "./tool.js";

test("registerGrokBuildTool registers a single prompt-only tool with capability guidance", () => {
  let registered: any;
  const pi = { registerTool(tool: any) { registered = tool; } };

  registerGrokBuildTool(pi as any, { runner: async () => ({ stdout: "ok", stderr: "", exitCode: 0 }) });

  assert.equal(registered.name, "grok_build");
  assert.deepEqual(Object.keys(registered.parameters.properties), ["prompt"]);
  const guidelines = registered.promptGuidelines.join("\n");
  assert.deepEqual(registered.promptGuidelines, [
    "Use grok_build only for image generation, image edit, and video generation.",
    "grok_build can do web search and web fetch, but prefer native pi tools for those tasks.",
    "Do not call grok_build for any other task.",
  ]);
});
