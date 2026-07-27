import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readSsmEnvConfig } from "./config";

test("readSsmEnvConfig reads explicit parameter mappings", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-ssm-env-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "pi-ssm-env-cwd-"));
  const agentDir = join(home, ".pi", "agent");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    join(agentDir, "settings.json"),
    JSON.stringify({
      ssmEnv: {
        profile: "company-dev",
        region: "ap-southeast-1",
        parameters: { DATABASE_URL: "/my-service/dev/DATABASE_URL" },
      },
    }),
    "utf8",
  );

  assert.deepEqual(readSsmEnvConfig(cwd, agentDir), {
    profile: "company-dev",
    region: "ap-southeast-1",
    parameters: { DATABASE_URL: "/my-service/dev/DATABASE_URL" },
  });
});

test("readSsmEnvConfig lets a trusted project replace the global config", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-ssm-env-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "pi-ssm-env-cwd-"));
  const agentDir = join(home, ".pi", "agent");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(
    join(agentDir, "settings.json"),
    JSON.stringify({ ssmEnv: { parameters: { GLOBAL: "/global" } } }),
    "utf8",
  );
  writeFileSync(
    join(cwd, ".pi", "settings.json"),
    JSON.stringify({ ssmEnv: { parameters: { PROJECT: "/project" } } }),
    "utf8",
  );

  assert.deepEqual(readSsmEnvConfig(cwd, agentDir), {
    parameters: { PROJECT: "/project" },
  });
  assert.deepEqual(
    readSsmEnvConfig(cwd, agentDir, { includeProject: false }),
    { parameters: { GLOBAL: "/global" } },
  );
});

test("readSsmEnvConfig rejects invalid explicit mappings", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-ssm-env-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "pi-ssm-env-cwd-"));
  const agentDir = join(home, ".pi", "agent");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    join(agentDir, "settings.json"),
    JSON.stringify({ ssmEnv: { parameters: { "NOT-AN-ENV": "/value" } } }),
    "utf8",
  );

  assert.throws(
    () => readSsmEnvConfig(cwd, agentDir),
    /invalid environment variable name: NOT-AN-ENV/,
  );
});
