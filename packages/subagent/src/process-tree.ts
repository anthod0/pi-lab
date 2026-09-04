import { spawnSync, type ChildProcess } from "node:child_process";

const activeProcessTrees = new Set<ChildProcess>();

function isRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null && child.pid !== undefined;
}

export function trackProcessTree(child: ChildProcess): void {
  activeProcessTrees.add(child);
  child.once("close", () => activeProcessTrees.delete(child));
}

export function terminateProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!isRunning(child)) return;

  const pid = child.pid;
  if (pid === undefined) return;

  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    if (result.status === 0) return;

    try {
      child.kill(signal);
    } catch {
      // The process may have exited while taskkill was running.
    }
    return;
  }

  try {
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process may have exited between the state check and the signal.
    }
  }
}

function waitForClose(child: ChildProcess): Promise<void> {
  if (!isRunning(child)) return Promise.resolve();
  return new Promise((resolve) => child.once("close", () => resolve()));
}

export async function terminateAllProcessTrees(gracePeriodMs = 1_000): Promise<void> {
  const children = [...activeProcessTrees];
  if (children.length === 0) return;

  for (const child of children) terminateProcessTree(child, "SIGTERM");

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timeoutId = setTimeout(resolve, gracePeriodMs);
  });
  await Promise.race([Promise.all(children.map(waitForClose)).then(() => undefined), timeout]);
  if (timeoutId) clearTimeout(timeoutId);

  for (const child of children) terminateProcessTree(child, "SIGKILL");
}

process.once("exit", () => {
  for (const child of activeProcessTrees) terminateProcessTree(child, "SIGKILL");
});
