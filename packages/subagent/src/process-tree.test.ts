import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import test from "node:test";
import { terminateAllProcessTrees, trackProcessTree } from "./process-tree.js";

const isWindows = process.platform === "win32";

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid: number, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isRunning(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Process ${pid} was still running after ${timeoutMs}ms`);
}

function waitForClose(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    child.once("close", () => resolve());
    child.once("error", reject);
  });
}

async function readPid(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const line = output.split("\n")[0];
      if (line && /^\d+$/.test(line)) resolve(Number(line));
    });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`Parent exited before reporting its child PID (${code})`)));
  });
}

test("terminates a tracked process and its descendants", { skip: isWindows }, async () => {
  const grandchildScript = 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);';
  const childScript = [
    'const { spawn } = require("node:child_process");',
    'process.on("SIGTERM", () => {});',
    `const child = spawn(process.execPath, ["-e", ${JSON.stringify(grandchildScript)}], { stdio: "ignore" });`,
    "console.log(child.pid);",
    "setInterval(() => {}, 1000);",
  ].join("\n");
  const child = spawn(process.execPath, ["-e", childScript], {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const childPid = child.pid;
  assert.ok(childPid);
  trackProcessTree(child);

  let grandchildPid: number | undefined;
  try {
    grandchildPid = await readPid(child);
    await terminateAllProcessTrees(50);
    await Promise.all([waitForExit(childPid), waitForExit(grandchildPid)]);
  } finally {
    if (isRunning(childPid)) process.kill(-childPid, "SIGKILL");
    if (grandchildPid && isRunning(grandchildPid)) process.kill(grandchildPid, "SIGKILL");
  }
});

test("terminates tracked processes when the parent exits", { skip: isWindows }, async () => {
  const moduleUrl = new URL("./process-tree.ts", import.meta.url).href;
  const fixtureScript = [
    'import { spawn } from "node:child_process";',
    `import { trackProcessTree } from ${JSON.stringify(moduleUrl)};`,
    'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });',
    "trackProcessTree(child);",
    "console.log(child.pid);",
    "process.exit(0);",
  ].join("\n");
  const fixture = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", fixtureScript], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const childPid = await readPid(fixture);

  try {
    await waitForClose(fixture);
    await waitForExit(childPid);
  } finally {
    if (isRunning(childPid)) process.kill(-childPid, "SIGKILL");
  }
});
