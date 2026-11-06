import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";

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

test("reads native search settings from PI_CODING_AGENT_DIR without injection", (t) => {
  const files = configFiles(t);
  files.write("global", JSON.stringify({ openai: { fast: true, webSearch: true } }));
  const result = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { loadConfig as websearch } from ${JSON.stringify(new URL("./native-search.ts", import.meta.url).href)};
    console.log(JSON.stringify(websearch(${JSON.stringify(files.cwd)})));
  `], { env: { ...process.env, PI_CODING_AGENT_DIR: files.agentDir }, encoding: "utf8" });
  assert.deepEqual(JSON.parse(result), { webSearch: true });
});

test("defaults to disabling native search without configuration", (t) => {
  const files = configFiles(t);
  assert.deepEqual(loadWebsearchConfig(files.cwd, files.agentDir), { webSearch: false });
});

for (const [project, expected] of [
  [{}, { webSearch: true }],
  [{ openai: {} }, { webSearch: true }],
  [{ openai: { webSearch: false } }, { webSearch: false }],
  [{ openai: { fast: false } }, { webSearch: true }],
] as const) {
  test(`project webSearch overrides the global value: ${JSON.stringify(project)}`, (t) => {
    const files = configFiles(t);
    files.write("global", JSON.stringify({ openai: { fast: true, webSearch: true } }));
    files.write("project", JSON.stringify(project));
    assert.deepEqual(loadWebsearchConfig(files.cwd, files.agentDir), expected);
  });
}

for (const invalid of ["{", "null", "[]", '{"openai":null}', '{"openai":[]}',
  '{"openai":{"webSearch":1}}', '{"openai":{"webSearch":"true"}}']) {
  test(`rejects invalid settings structure or webSearch: ${invalid}`, (t) => {
    const files = configFiles(t);
    files.write("project", invalid);
    assert.throws(() => loadWebsearchConfig(files.cwd, files.agentDir));
  });
}

test("reads webSearch alongside unrelated Pi and extension settings", (t) => {
  const files = configFiles(t);
  files.write("global", JSON.stringify({ theme: "dark", openai: { fast: true } }));
  files.write("project", JSON.stringify({ websearch: { provider: "exa" }, openai: { webSearch: true } }));
  assert.deepEqual(loadWebsearchConfig(files.cwd, files.agentDir), { webSearch: true });
});

test("a valid project override does not hide an invalid global webSearch value", (t) => {
  const files = configFiles(t);
  files.write("global", '{"openai":{"webSearch":"true"}}');
  files.write("project", '{"openai":{"fast":false,"webSearch":true}}');
  assert.throws(() => loadWebsearchConfig(files.cwd, files.agentDir));
});

test("ignores unknown fields and settings owned by other features in both scopes", (t) => {
  const files = configFiles(t);
  files.write("global", JSON.stringify({ openai: { webSearch: true, fast: "invalid", futureOption: [1, 2] } }));
  files.write("project", JSON.stringify({ openai: { imageGeneration: null, webSerch: false, anotherOption: {} } }));
  assert.deepEqual(loadWebsearchConfig(files.cwd, files.agentDir), { webSearch: true });
});
