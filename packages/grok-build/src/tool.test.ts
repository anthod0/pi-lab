import assert from "node:assert/strict";
import test from "node:test";

import { registerGrokBuildTool } from "./tool.js";

test("registerGrokBuildTool registers a single prompt-only tool with Grok capability guidance", () => {
  let registered: any;
  const pi = { registerTool(tool: any) { registered = tool; } };

  registerGrokBuildTool(pi as any, { runner: async () => ({ stdout: "ok", stderr: "", exitCode: 0 }) });

  assert.equal(registered.name, "grok_build");
  assert.deepEqual(Object.keys(registered.parameters.properties), ["prompt"]);
  assert.match(registered.description, /X\/Twitter search and thread fetch/);
});
