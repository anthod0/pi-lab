import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";

import { loadConfig as loadOpenAIConfig } from "../../openai/src/config";
import { loadConfig as loadWebsearchConfig } from "./native-search.js";

function configFiles(t: TestContext) {
  const testRoot = mkdtempDisposableSync(join(tmpdir(), "pi-search-config-parity-"));
  t.after(() => testRoot.remove());
  const agentDir = join(testRoot.path, "custom agent");
  const cwd = join(testRoot.path, "project");
  return {
    agentDir, cwd,
    write(scope: "global" | "project", text: string) {
      const path = scope === "global"
        ? join(agentDir, "settings.json")
        : join(cwd, ".pi", "settings.json");
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    },
  };
}

// Both independent implementations must satisfy the same outcomes. Neither is
// used as the other's expected result, so a common regression still fails.
const loaders = [loadOpenAIConfig, loadWebsearchConfig];

test("both extensions read native search settings from PI_CODING_AGENT_DIR without injection", (t) => {
  const files = configFiles(t);
  files.write("global", JSON.stringify({ openai: { fast: true, webSearch: true } }));
  const result = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { loadConfig as openai } from ${JSON.stringify(new URL("../../openai/src/config.ts", import.meta.url).href)};
    import { loadConfig as websearch } from ${JSON.stringify(new URL("./native-search.ts", import.meta.url).href)};
    console.log(JSON.stringify([openai, websearch].map(load => load(${JSON.stringify(files.cwd)}))));
  `], { env: { ...process.env, PI_CODING_AGENT_DIR: files.agentDir }, encoding: "utf8" });
  assert.deepEqual(JSON.parse(result), [
    { fast: true, webSearch: true },
    { fast: true, webSearch: true },
  ]);
});

test("both extensions default to disabling native search without configuration", (t) => {
  const files = configFiles(t);
  for (const load of loaders) assert.deepEqual(load(files.cwd, files.agentDir), { fast: false, webSearch: false });
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
    for (const load of loaders) assert.deepEqual(load(files.cwd, files.agentDir), expected);
  });
}

for (const invalid of ["{", "null", "[]", '{"openai":null}', '{"openai":[]}',
  '{"openai":{"webSearch":1}}', '{"openai":{"fast":"true"}}', '{"openai":{"webSerch":true}}']) {
  test(`both extensions reject invalid config: ${invalid}`, (t) => {
    const files = configFiles(t);
    files.write("project", invalid);
    for (const load of loaders) assert.throws(() => load(files.cwd, files.agentDir), /Invalid OpenAI config/);
  });
}

test("both extensions read OpenAI settings alongside unrelated Pi and extension settings", (t) => {
  const files = configFiles(t);
  files.write("global", JSON.stringify({ theme: "dark", openai: { fast: true } }));
  files.write("project", JSON.stringify({ websearch: { provider: "exa" }, openai: { webSearch: true } }));
  for (const load of loaders) assert.deepEqual(load(files.cwd, files.agentDir), { fast: true, webSearch: true });
});

test("neither extension masks invalid global config with a valid project override", (t) => {
  const files = configFiles(t);
  files.write("global", '{"openai":{"fast":"true"}}');
  files.write("project", '{"openai":{"fast":false,"webSearch":true}}');
  for (const load of loaders) assert.throws(() => load(files.cwd, files.agentDir), /Invalid OpenAI config/);
});
