import assert from "node:assert/strict";
import test from "node:test";

import { buildGrokArgs, normalizePrompt, runGrokBuild, type GrokRunner } from "./grok.js";

test("normalizePrompt trims prompt and rejects empty input", () => {
  assert.equal(normalizePrompt("  make an image of a red panda  "), "make an image of a red panda");
  assert.throws(() => normalizePrompt("   "), /prompt must not be empty/i);
});

test("buildGrokArgs builds safe headless Grok CLI arguments", () => {
  assert.deepEqual(buildGrokArgs("make a video", "/tmp/project"), [
    "--no-auto-update",
    "-p",
    "make a video",
    "--output-format",
    "plain",
    "--always-approve",
    "--cwd",
    "/tmp/project",
  ]);
});

test("runGrokBuild returns stdout stderr and execution details", async () => {
  const calls: Array<{ command: string; args: string[]; options: { timeoutMs: number } }> = [];
  const runner: GrokRunner = async (command, args, options) => {
    calls.push({ command, args, options });
    return { stdout: "created ./image.png\n", stderr: "note\n", exitCode: 0 };
  };

  const result = await runGrokBuild({ prompt: "draw a cat" }, { cwd: "/work", command: "custom-grok", timeoutMs: 1234, runner });

  assert.equal(result.stdout, "created ./image.png\n");
  assert.equal(result.stderr, "note\n");
  assert.deepEqual(result.details, {
    command: "custom-grok",
    args: buildGrokArgs("draw a cat", "/work"),
    cwd: "/work",
    timeoutMs: 1234,
    exitCode: 0,
  });
  assert.equal(calls.length, 1);
});

test("runGrokBuild throws with stderr when Grok exits non-zero", async () => {
  const runner: GrokRunner = async () => ({ stdout: "", stderr: "auth failed", exitCode: 2 });

  await assert.rejects(
    () => runGrokBuild({ prompt: "draw" }, { runner }),
    /Grok Build failed with exit code 2: auth failed/,
  );
});
