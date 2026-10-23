import assert from "node:assert/strict";
import { mkdirSync, mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";

import { loadConfig as loadOpenAIConfig } from "../../openai/src/config";
import { loadConfig as loadWebsearchConfig } from "./native-search.js";

function configFiles(t: TestContext) {
  const testRoot = mkdtempDisposableSync(join(tmpdir(), "pi-search-config-parity-"));
  t.after(() => testRoot.remove());
  const home = join(testRoot.path, "home");
  const cwd = join(testRoot.path, "project");
  return {
    home, cwd,
    write(scope: "global" | "project", text: string) {
      const path = scope === "global"
        ? join(home, ".pi", "agent", "pi-lab", "openai.json")
        : join(cwd, ".pi", "pi-lab", "openai.json");
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    },
  };
}

// Both independent implementations must satisfy the same outcomes. Neither is
// used as the other's expected result, so a common regression still fails.
const loaders = [loadOpenAIConfig, loadWebsearchConfig];

test("both extensions default to disabling native search without configuration", (t) => {
  const files = configFiles(t);
  for (const load of loaders) assert.deepEqual(load(files.cwd, files.home), { fast: false, webSearch: false });
});

for (const [project, expected] of [
  [{}, { fast: true, webSearch: true }],
  [{ openai: {} }, { fast: true, webSearch: true }],
  [{ openai: { webSearch: false } }, { fast: true, webSearch: false }],
  [{ openai: { fast: false } }, { fast: false, webSearch: true }],
] as const) {
  test(`both extensions merge per-field overrides: ${JSON.stringify(project)}`, (t) => {
    const files = configFiles(t);
    files.write("global", JSON.stringify({ openai: { fast: true, webSearch: true } }));
    files.write("project", JSON.stringify(project));
    for (const load of loaders) assert.deepEqual(load(files.cwd, files.home), expected);
  });
}

for (const invalid of ["{", "null", "[]", '{"openai":null}', '{"openai":[]}',
  '{"openai":{"webSearch":1}}', '{"openai":{"fast":"true"}}', '{"openai":{"webSerch":true}}']) {
  test(`both extensions reject invalid config: ${invalid}`, (t) => {
    const files = configFiles(t);
    files.write("project", invalid);
    for (const load of loaders) assert.throws(() => load(files.cwd, files.home), /Invalid OpenAI config/);
  });
}

test("neither extension masks invalid global config with a valid project override", (t) => {
  const files = configFiles(t);
  files.write("global", '{"openai":{"fast":"true"}}');
  files.write("project", '{"openai":{"fast":false,"webSearch":true}}');
  for (const load of loaders) assert.throws(() => load(files.cwd, files.home), /Invalid OpenAI config/);
});
