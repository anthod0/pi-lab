import assert from "node:assert/strict";
import test from "node:test";

import { registerXSearchTool } from "./tool.js";

test("registerXSearchTool registers intent-only parameters", () => {
  let registered: any;
  const pi = { registerTool(tool: any) { registered = tool; } };

  registerXSearchTool(pi as any, { env: { XAI_API_KEY: "key" }, settings: {} });

  assert.equal(registered.name, "xsearch");
  const properties = registered.parameters.properties;
  assert.ok(properties.query);
  assert.ok(properties.allowed_x_handles);
  assert.ok(properties.excluded_x_handles);
  assert.ok(properties.from_date);
  assert.ok(properties.to_date);
  assert.equal(properties.model, undefined);
  assert.equal(properties.enable_image_understanding, undefined);
  assert.equal(properties.enable_video_understanding, undefined);
});
