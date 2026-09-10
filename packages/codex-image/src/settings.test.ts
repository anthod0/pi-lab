import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MODEL, readImageModel } from "./settings.js";

// Explicit settings roots only; never change HOME or access real user settings.
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-image-settings-test-"));
  const home = join(root, "user");
  const cwd = join(root, "project");
  await mkdir(join(home, ".pi", "agent"), { recursive: true });
  await mkdir(join(cwd, ".pi"), { recursive: true });
  const user = (value: unknown) => writeFile(join(home, ".pi", "agent", "settings.json"), JSON.stringify(value));
  const project = (value: unknown) => writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify(value));
  return { cwd, home, user, project };
}

test("defaults to gpt-5.6-sol without configuration", async () => {
  const f = await fixture();
  assert.equal(readImageModel(f.cwd, true, f.home), "gpt-5.6-sol");
  await f.user({ codexImage: {} });
  assert.equal(readImageModel(f.cwd, true, f.home), DEFAULT_MODEL);
});

test("reads global model, allows trusted project override, and reloads on each call", async () => {
  const f = await fixture();
  await f.user({ codexImage: { model: "gpt-5.5" } });
  assert.equal(readImageModel(f.cwd, false, f.home), "gpt-5.5");
  await f.project({ codexImage: { model: " gpt-5.6-luna " } });
  assert.equal(readImageModel(f.cwd, true, f.home), "gpt-5.6-luna");
  assert.equal(readImageModel(f.cwd, false, f.home), "gpt-5.5");
});

test("does not read malformed untrusted project settings", async () => {
  const f = await fixture();
  await writeFile(join(f.cwd, ".pi", "settings.json"), "invalid JSON");
  assert.equal(readImageModel(f.cwd, false, f.home), DEFAULT_MODEL);
});

test("rejects invalid configuration instead of silently falling back", async () => {
  const f = await fixture();
  for (const config of [null, [], "model", { model: null }, { model: 123 }, { model: "  " }]) {
    await f.user({ codexImage: config });
    assert.throws(() => readImageModel(f.cwd, false, f.home), /codexImage/);
  }
});
