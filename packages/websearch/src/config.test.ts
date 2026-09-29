import assert from "node:assert/strict";
import test from "node:test";

import { resolveWebSearchProvider } from "./config.js";

test("environment provider overrides Pi settings", () => {
  assert.equal(
    resolveWebSearchProvider(
      { WEBSEARCH_PROVIDER: "parallel" },
      { websearch: { provider: "exa" } },
    ),
    "parallel",
  );
});

test("provider can be selected from Pi settings", () => {
  assert.equal(resolveWebSearchProvider({}, { websearch: { provider: "parallel" } }), "parallel");
});

test("provider is inferred only when Parallel is the sole configured key", () => {
  assert.equal(resolveWebSearchProvider({ PARALLEL_API_KEY: "key" }), "parallel");
  assert.equal(resolveWebSearchProvider({ EXA_API_KEY: "key" }), "exa");
  assert.equal(resolveWebSearchProvider({ EXA_API_KEY: "exa", PARALLEL_API_KEY: "parallel" }), "exa");
  assert.equal(resolveWebSearchProvider({}), "exa");
});

test("invalid provider configuration is rejected", () => {
  assert.throws(() => resolveWebSearchProvider({ WEBSEARCH_PROVIDER: "other" }), /WEBSEARCH_PROVIDER/);
  assert.throws(() => resolveWebSearchProvider({}, { websearch: { provider: "other" } }), /websearch\.provider/);
  assert.throws(() => resolveWebSearchProvider({}, { websearch: "parallel" }), /websearch must be an object/);
});
