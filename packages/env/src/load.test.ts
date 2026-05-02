import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { getGlobalEnvPath } from "./config";
import { loadGlobalEnv } from "./load";

test("getGlobalEnvPath resolves ~/.pi/agent/.env", () => {
  assert.equal(getGlobalEnvPath("/tmp/home"), "/tmp/home/.pi/agent/.env");
});

test("loadGlobalEnv skips missing file", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-env-home-"));
  const target: NodeJS.ProcessEnv = {};

  const result = loadGlobalEnv(target, getGlobalEnvPath(home));

  assert.equal(result.exists, false);
  assert.deepEqual(result.loadedKeys, []);
  assert.deepEqual(result.skippedKeys, []);
  assert.deepEqual(target, {});
});

test("loadGlobalEnv preserves existing target values and injects missing values", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-env-home-"));
  const envPath = getGlobalEnvPath(home);
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  writeFileSync(envPath, "EXISTING=from-file\nNEW_VALUE=from-file\n", "utf8");

  const target: NodeJS.ProcessEnv = { EXISTING: "from-shell" };

  const result = loadGlobalEnv(target, envPath);

  assert.equal(target.EXISTING, "from-shell");
  assert.equal(target.NEW_VALUE, "from-file");
  assert.deepEqual(result.loadedKeys, ["NEW_VALUE"]);
  assert.deepEqual(result.skippedKeys, ["EXISTING"]);
});

test("loadGlobalEnv parses with isolated processEnv", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-env-home-"));
  const envPath = getGlobalEnvPath(home);
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  writeFileSync(envPath, "DERIVED=${AMBIENT_TEST}\n", "utf8");

  process.env.AMBIENT_TEST = "from-process";
  const target: NodeJS.ProcessEnv = {};

  loadGlobalEnv(target, envPath);

  assert.equal(target.DERIVED, "");
  delete process.env.AMBIENT_TEST;
});

test("loadGlobalEnv surfaces read failures with config path", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-env-home-"));
  const envPath = getGlobalEnvPath(home);
  mkdirSync(envPath, { recursive: true });

  assert.throws(
    () => loadGlobalEnv({}, envPath),
    /Failed to load ~\/\.pi\/agent\/\.env/,
  );
});

test("falls back to legacy ~/.pi/agent/pi-lab/.env when new file is missing", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-env-home-"));
  const legacyEnvPath = join(home, ".pi", "agent", "pi-lab", ".env");
  mkdirSync(join(home, ".pi", "agent", "pi-lab"), { recursive: true });
  writeFileSync(legacyEnvPath, "LEGACY_VALUE=from-legacy\n", "utf8");

  const target: NodeJS.ProcessEnv = {};
  const result = loadGlobalEnv(target, getGlobalEnvPath(home));

  assert.equal(target.LEGACY_VALUE, "from-legacy");
  assert.equal(result.exists, true);
  assert.equal(result.path, legacyEnvPath);
});

test("prefers ~/.pi/agent/.env over legacy ~/.pi/agent/pi-lab/.env", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-env-home-"));
  const envPath = getGlobalEnvPath(home);
  const legacyEnvPath = join(home, ".pi", "agent", "pi-lab", ".env");
  mkdirSync(join(home, ".pi", "agent", "pi-lab"), { recursive: true });
  writeFileSync(envPath, "VALUE=from-new\n", "utf8");
  writeFileSync(legacyEnvPath, "VALUE=from-legacy\n", "utf8");

  const target: NodeJS.ProcessEnv = {};
  const result = loadGlobalEnv(target, envPath);

  assert.equal(target.VALUE, "from-new");
  assert.equal(result.path, envPath);
});

test("injected env is inherited by child processes", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-env-home-"));
  const envPath = getGlobalEnvPath(home);
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  writeFileSync(envPath, "PI_LAB_CHILD_TEST=from-file\n", "utf8");

  const target: NodeJS.ProcessEnv = {};
  loadGlobalEnv(target, envPath);

  const child = spawnSync(
    process.execPath,
    ["-e", "process.stdout.write(process.env.PI_LAB_CHILD_TEST ?? '')"],
    { env: target, encoding: "utf8" },
  );

  assert.equal(child.status, 0);
  assert.equal(child.stdout, "from-file");
});
