import assert from "node:assert/strict";
import { mkdirSync, mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";

import { readWebSearchProvider, resolveWebSearchProvider } from "./config.js";

function settingsFiles(t: TestContext) {
  const testRoot = mkdtempDisposableSync(join(tmpdir(), "pi-websearch-settings-"));
  t.after(() => testRoot.remove());
  const home = join(testRoot.path, "home");
  const cwd = join(testRoot.path, "project");
  return {
    home, cwd,
    write(scope: "global" | "project", text: string) {
      const path = scope === "global"
        ? join(home, ".pi", "agent", "settings.json")
        : join(cwd, ".pi", "settings.json");
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    },
  };
}

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

test("missing settings files allow provider inference from explicitly supplied keys", (t) => {
  const files = settingsFiles(t);
  assert.equal(readWebSearchProvider({ ...files, projectTrusted: false, env: { EXA_API_KEY: "test" } }), "exa");
});

test("user settings select the provider without loading untrusted project settings", (t) => {
  const files = settingsFiles(t);
  files.write("global", JSON.stringify({ websearch: { provider: "parallel" } }));
  files.write("project", "invalid JSON");
  assert.equal(readWebSearchProvider({ ...files, projectTrusted: false, env: {} }), "parallel");
});

test("trusted project provider overrides user settings", (t) => {
  const files = settingsFiles(t);
  files.write("global", JSON.stringify({ websearch: { provider: "parallel" } }));
  files.write("project", JSON.stringify({ websearch: { provider: "tinyfish" } }));
  assert.equal(readWebSearchProvider({ ...files, projectTrusted: true, env: {} }), "tinyfish");
});

test("a project section without a provider retains the global provider", (t) => {
  const files = settingsFiles(t);
  files.write("global", JSON.stringify({ websearch: { provider: "exa" } }));
  files.write("project", JSON.stringify({ websearch: {} }));
  assert.equal(readWebSearchProvider({ ...files, projectTrusted: true, env: {} }), "exa");
});

test("environment selection overrides merged settings", (t) => {
  const files = settingsFiles(t);
  files.write("global", JSON.stringify({ websearch: { provider: "exa" } }));
  files.write("project", JSON.stringify({ websearch: { provider: "parallel" } }));
  assert.equal(readWebSearchProvider({ ...files, projectTrusted: true, env: { WEBSEARCH_PROVIDER: "tinyfish" } }), "tinyfish");
});

for (const scope of ["global", "project"] as const) {
  test(`invalid JSON in ${scope} settings is reported`, (t) => {
    const files = settingsFiles(t);
    files.write(scope, "{");
    assert.throws(() => readWebSearchProvider({ ...files, projectTrusted: true, env: { EXA_API_KEY: "test" } }), SyntaxError);
  });
}

test("an invalid project section does not fall back to a valid user provider", (t) => {
  const files = settingsFiles(t);
  files.write("global", JSON.stringify({ websearch: { provider: "exa" } }));
  files.write("project", JSON.stringify({ websearch: null }));
  assert.throws(() => readWebSearchProvider({ ...files, projectTrusted: true, env: {} }), /websearch/);
});
