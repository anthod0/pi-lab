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

test("provider is inferred by Parallel, TinyFish, then Exa priority", () => {
  assert.equal(resolveWebSearchProvider({ PARALLEL_API_KEY: "key" }), "parallel");
  assert.equal(resolveWebSearchProvider({ TINYFISH_API_KEY: "key" }), "tinyfish");
  assert.equal(resolveWebSearchProvider({ EXA_API_KEY: "key" }), "exa");
  assert.equal(resolveWebSearchProvider({ EXA_API_KEY: "exa", PARALLEL_API_KEY: "parallel" }), "parallel");
  assert.equal(resolveWebSearchProvider({ EXA_API_KEY: "exa", TINYFISH_API_KEY: "tinyfish" }), "tinyfish");
  assert.equal(resolveWebSearchProvider({ PARALLEL_API_KEY: "parallel", TINYFISH_API_KEY: "tinyfish" }), "parallel");
  assert.throws(() => resolveWebSearchProvider({}), /No websearch provider API key is configured/);
});

test("invalid provider configuration is rejected", () => {
  assert.throws(() => resolveWebSearchProvider({ WEBSEARCH_PROVIDER: "other" }), /WEBSEARCH_PROVIDER/);
  assert.throws(() => resolveWebSearchProvider({}, { websearch: { provider: "other" } }), /websearch\.provider/);
  assert.throws(() => resolveWebSearchProvider({}, { websearch: "parallel" }), /websearch must be an object/);
});
