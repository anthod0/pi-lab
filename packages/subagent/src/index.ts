import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  keyHint,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";

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
  results: TaskResult[];
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
    stdio: ["ignore", "pipe", "pipe"],
  });

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

  const abort = (): void => {
    child.kill("SIGTERM");
  };
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });

  const exitCode = await new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
  });
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

function formatResults(results: TaskResult[]): string {
  if (results.length === 1) return results[0].output;

  return results
    .map((result, index) => `## Task ${index + 1}\n\n${result.output}`)
    .join("\n\n---\n\n");
}

function failureMessage(result: TaskResult): string | undefined {
  if (result.exitCode === 0 && result.stopReason !== "error" && result.stopReason !== "aborted") return undefined;
  return result.errorMessage || result.stderr.trim() || result.output || `Child exited with code ${result.exitCode}`;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: TOOL_NAME,
    label: "Subagent",
    description: "Run one or more independent tasks in parallel headless pi processes and wait for all results.",
    parameters: Type.Object({
      tasks: Type.Array(Type.String({ minLength: 1 }), {
        minItems: 1,
        description: "Complete prompts for independent subagents. All tasks run concurrently.",
      }),
    }),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
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

      let completed = 0;
      const results = await Promise.all(
        params.tasks.map(async (task) => {
          const result = await runTask(task, childArgs, ctx.cwd, signal);
          completed += 1;
          onUpdate?.({
            content: [{ type: "text", text: `${completed}/${params.tasks.length} subagents completed` }],
            details: { results: [] },
          });
          return result;
        }),
      );

      if (signal?.aborted) throw new Error("Subagents were aborted");

      const failures = results
        .map((result, index) => ({ index, message: failureMessage(result) }))
        .filter((failure): failure is { index: number; message: string } => Boolean(failure.message));
      if (failures.length > 0) {
        throw new Error(failures.map(({ index, message }) => `Task ${index + 1}: ${message}`).join("\n\n"));
      }

      const fullOutput = formatResults(results);
      const truncated = truncateHead(fullOutput, {
        maxBytes: DEFAULT_MAX_BYTES,
        maxLines: DEFAULT_MAX_LINES,
      });
      const output = truncated.truncated
        ? `${truncated.content}\n\n[Output truncated. Full output is preserved in tool details.]`
        : truncated.content;
      const usage: AssistantUsage = {};
      for (const result of results) addUsage(usage, result.usage);

      return {
        content: [{ type: "text", text: output || "(no output)" }],
        details: { results } satisfies SubagentDetails,
        usage,
      };
    },

    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      const count = args.tasks.length;
      let content = theme.fg("toolTitle", theme.bold("Input "));
      content += theme.fg("accent", `${count} ${count === 1 ? "task" : "tasks"}`);

      if (context.expanded) {
        for (const [index, task] of args.tasks.entries()) {
          content += `\n  ${theme.fg("muted", `${index + 1}.`)} ${theme.fg("dim", task)}`;
        }
      }

      text.setText(content);
      return text;
    },

    renderResult(result, options, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      const raw = result.content.find((content) => content.type === "text")?.text ?? "";

      if (options.isPartial) {
        text.setText(`${theme.fg("toolTitle", theme.bold("Output "))}${theme.fg("muted", raw || "Running…")}`);
        return text;
      }

      if (context.isError) {
        text.setText(`${theme.fg("toolTitle", theme.bold("Output"))}\n${theme.fg("error", raw)}`);
        return text;
      }

      const lines = raw.split("\n");
      const shown = options.expanded ? lines : lines.slice(0, 10);
      const remaining = lines.length - shown.length;
      let content = theme.fg("toolTitle", theme.bold("Output"));
      if (shown.length > 0) {
        content += `\n${shown.map((line) => theme.fg("toolOutput", line)).join("\n")}`;
      }
      if (remaining > 0) {
        content += theme.fg("muted", `\n… (${remaining} more lines, `);
        content += keyHint("app.tools.expand", "to expand");
        content += theme.fg("muted", ")");
      }

      text.setText(content);
      return text;
    },
  });
}
