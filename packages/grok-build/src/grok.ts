import { spawn } from "node:child_process";

export interface GrokBuildParams {
  prompt: string;
}

export interface GrokRunnerResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export type GrokRunner = (
  command: string,
  args: string[],
  options: { timeoutMs: number; signal?: AbortSignal },
) => Promise<GrokRunnerResult>;

export interface GrokBuildOptions {
  cwd?: string;
  timeoutMs?: number;
  command?: string;
  runner?: GrokRunner;
  signal?: AbortSignal;
}

export interface GrokBuildDetails {
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs: number;
  exitCode: number | null;
}

export interface GrokBuildResult {
  stdout: string;
  stderr: string;
  details: GrokBuildDetails;
}

export const DEFAULT_GROK_COMMAND = "grok";
export const DEFAULT_GROK_TIMEOUT_MS = 10 * 60 * 1000;

export function normalizePrompt(prompt: string): string {
  const normalized = prompt.trim();
  if (!normalized) throw new Error("grok_build prompt must not be empty");
  return normalized;
}

export function buildGrokArgs(prompt: string, cwd?: string): string[] {
  const args = [
    "--no-auto-update",
    "-p",
    prompt,
    "--output-format",
    "plain",
    "--always-approve",
  ];
  if (cwd) args.push("--cwd", cwd);
  return args;
}

export async function runGrokBuild(
  params: GrokBuildParams,
  options: GrokBuildOptions = {},
): Promise<GrokBuildResult> {
  const prompt = normalizePrompt(params.prompt);
  const command = options.command ?? DEFAULT_GROK_COMMAND;
  const timeoutMs = options.timeoutMs ?? DEFAULT_GROK_TIMEOUT_MS;
  const args = buildGrokArgs(prompt, options.cwd);
  const runner = options.runner ?? spawnGrok;
  const result = await runner(command, args, { timeoutMs, signal: options.signal });

  if (result.exitCode !== 0) {
    const message = (result.stderr || result.stdout || "unknown error").trim();
    throw new Error(`Grok Build failed with exit code ${result.exitCode}: ${message}`);
  }

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    details: {
      command,
      args,
      cwd: options.cwd,
      timeoutMs,
      exitCode: result.exitCode,
    },
  };
}

export const spawnGrok: GrokRunner = (command, args, options) => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], signal: options.signal });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`Grok Build timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode });
    });
  });
};
