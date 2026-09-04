import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text, TruncatedText, type Component } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";
import { terminateAllProcessTrees, terminateProcessTree, trackProcessTree } from "./process-tree.js";

const TOOL_NAME = "subagent";

interface AssistantUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
}

interface AssistantMessage {
  role: "assistant";
  content: Array<{ type: string; text?: string }>;
  stopReason?: string;
  errorMessage?: string;
  usage?: AssistantUsage;
}

interface TaskResult {
  task: string;
  output: string;
  stderr: string;
  exitCode: number;
  stopReason?: string;
  errorMessage?: string;
  usage: AssistantUsage;
}

interface SubagentDetails {
  result: TaskResult;
}

function emptyComponent(): Component {
  return {
    render: () => [],
    invalidate: () => {},
  };
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");

  if (currentScript && !isBunVirtualScript && existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const executable = basename(process.execPath).toLowerCase();
  if (!/^(node|bun)(\.exe)?$/.test(executable)) {
    return { command: process.execPath, args };
  }

  return { command: "pi", args };
}

function getText(message: AssistantMessage): string {
  return message.content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function addUsage(total: AssistantUsage, usage: AssistantUsage | undefined): void {
  if (!usage) return;

  total.input = (total.input ?? 0) + (usage.input ?? 0);
  total.output = (total.output ?? 0) + (usage.output ?? 0);
  total.cacheRead = (total.cacheRead ?? 0) + (usage.cacheRead ?? 0);
  total.cacheWrite = (total.cacheWrite ?? 0) + (usage.cacheWrite ?? 0);
  total.totalTokens = (total.totalTokens ?? 0) + (usage.totalTokens ?? 0);
  total.cost ??= {};
  total.cost.input = (total.cost.input ?? 0) + (usage.cost?.input ?? 0);
  total.cost.output = (total.cost.output ?? 0) + (usage.cost?.output ?? 0);
  total.cost.cacheRead = (total.cost.cacheRead ?? 0) + (usage.cost?.cacheRead ?? 0);
  total.cost.cacheWrite = (total.cost.cacheWrite ?? 0) + (usage.cost?.cacheWrite ?? 0);
  total.cost.total = (total.cost.total ?? 0) + (usage.cost?.total ?? 0);
}

async function runTask(
  task: string,
  args: string[],
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<TaskResult> {
  const invocation = getPiInvocation([...args, "--", task]);
  const child = spawn(invocation.command, invocation.args, {
    cwd,
    env: process.env,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  trackProcessTree(child);

  let stdoutBuffer = "";
  let stderr = "";
  let finalOutput = "";
  let stopReason: string | undefined;
  let errorMessage: string | undefined;
  let spawnError: string | undefined;
  const usage: AssistantUsage = {};

  const processLine = (line: string): void => {
    if (!line.trim()) return;

    try {
      const event = JSON.parse(line) as { type?: string; message?: AssistantMessage };
      if (event.type !== "message_end" || event.message?.role !== "assistant") return;

      const text = getText(event.message);
      if (text) finalOutput = text;
      stopReason = event.message.stopReason;
      errorMessage = event.message.errorMessage;
      addUsage(usage, event.message.usage);
    } catch {
      // Ignore non-JSON diagnostic output from the child.
    }
  };

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString("utf8");
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) processLine(line);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  child.on("error", (error) => {
    spawnError = error.message;
  });

  let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
  const abort = (): void => {
    terminateProcessTree(child, "SIGTERM");
    forceKillTimer = setTimeout(() => terminateProcessTree(child, "SIGKILL"), 1_000);
    forceKillTimer.unref();
  };
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });

  const exitCode = await new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
  });
  if (forceKillTimer) clearTimeout(forceKillTimer);
  signal?.removeEventListener("abort", abort);
  if (stdoutBuffer.trim()) processLine(stdoutBuffer);

  return {
    task,
    output: finalOutput,
    stderr,
    exitCode,
    stopReason,
    errorMessage: spawnError ?? errorMessage,
    usage,
  };
}

function failureMessage(result: TaskResult): string | undefined {
  if (result.exitCode === 0 && result.stopReason !== "error" && result.stopReason !== "aborted") return undefined;
  return result.errorMessage || result.stderr.trim() || result.output || `Child exited with code ${result.exitCode}`;
}

export default function (pi: ExtensionAPI) {
  pi.on("session_shutdown", async () => {
    await terminateAllProcessTrees();
  });

  pi.registerTool({
    name: TOOL_NAME,
    label: "Subagent",
    description: "Run one independent task. Call this tool multiple times in the same response to run tasks concurrently.",
    parameters: Type.Object({
      task: Type.String({
        minLength: 1,
        description: "Complete prompt for the subagent",
      }),
    }),

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const activeTools = pi.getActiveTools().filter((name) => name !== TOOL_NAME);
      const childArgs = [
        "--mode",
        "json",
        "--print",
        "--no-session",
        "--exclude-tools",
        TOOL_NAME,
        "--approve",
        "--thinking",
        pi.getThinkingLevel(),
      ];

      if (ctx.model) childArgs.push("--model", `${ctx.model.provider}/${ctx.model.id}`);
      if (activeTools.length > 0) childArgs.push("--tools", activeTools.join(","));
      else childArgs.push("--no-tools");

      const result = await runTask(params.task, childArgs, ctx.cwd, signal);

      if (signal?.aborted) throw new Error("Subagent was aborted");

      const failure = failureMessage(result);
      if (failure) throw new Error(failure);

      return {
        content: [{ type: "text", text: result.output || "(no output)" }],
        details: { result } satisfies SubagentDetails,
        usage: result.usage,
      };
    },

    renderCall(args, theme, context) {
      const title = theme.fg("toolTitle", theme.bold("Subagent"));
      if (!context.expanded) {
        return new TruncatedText(`${title} ${theme.fg("dim", args.task)}`, 0, 0);
      }

      const text = context.lastComponent instanceof Text
        ? context.lastComponent
        : new Text("", 0, 0);
      text.setText(`${title}\n${theme.fg("dim", args.task)}`);
      return text;
    },

    renderResult(result, options, theme, context) {
      const text = context.lastComponent instanceof Text
        ? context.lastComponent
        : new Text("", 0, 0);
      const raw = result.content.find((content) => content.type === "text")?.text ?? "";

      if (options.isPartial) {
        const progress = raw ? ` ${raw}` : "…";
        text.setText(`${theme.fg("toolTitle", theme.bold("Running"))}${theme.fg("muted", progress)}`);
        return text;
      }

      if (!options.expanded) return emptyComponent();

      if (context.isError) {
        text.setText(`${theme.fg("toolTitle", theme.bold("Result"))}\n${theme.fg("error", raw)}`);
        return text;
      }

      const lines = raw.split("\n");
      let content = theme.fg("toolTitle", theme.bold("Result"));
      if (lines.length > 0) {
        content += `\n${lines.map((line) => theme.fg("toolOutput", line)).join("\n")}`;
      }

      text.setText(content);
      return text;
    },
  });
}
