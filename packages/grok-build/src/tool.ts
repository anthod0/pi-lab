import { Type } from "@sinclair/typebox";
import { type ExtensionAPI, keyHint } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { runGrokBuild, type GrokBuildDetails, type GrokBuildOptions, type GrokRunner } from "./grok.js";

export interface GrokBuildToolOptions extends Pick<GrokBuildOptions, "command" | "timeoutMs"> {
  runner?: GrokRunner;
}

export function registerGrokBuildTool(pi: ExtensionAPI, options: GrokBuildToolOptions = {}): void {
  pi.registerTool({
    name: "grok_build",
    label: "Grok Build",
    description: "Run the local Grok Build CLI in headless mode with a single natural-language prompt.",
    promptSnippet: "Use Grok Build for image or video generation from a prompt",
    promptGuidelines: [
      "Use grok_build only for image generation, image edit, and video generation.",
      "grok_build can do web search and web fetch, but prefer native pi tools for those tasks.",
      "Do not call grok_build for any other task.",
    ],
    parameters: Type.Object({
      prompt: Type.String({ description: "Natural-language instruction for Grok Build. Grok Build decides the task type from this prompt." }),
    }),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Running Grok Build…" }], details: {} });
      const result = await runGrokBuild(
        { prompt: params.prompt },
        { cwd: ctx.cwd, command: options.command, timeoutMs: options.timeoutMs, runner: options.runner, signal },
      );

      const text = result.stdout.trim() || result.stderr.trim() || "Grok Build completed without text output.";
      return {
        content: [{ type: "text", text }],
        details: result.details,
      };
    },

    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      const prompt = typeof args.prompt === "string" ? args.prompt : "";
      const preview = prompt.length > 100 ? `${prompt.slice(0, 97)}…` : prompt;
      text.setText(theme.fg("toolTitle", theme.bold("grok_build ")) + theme.fg("accent", preview));
      return text;
    },

    renderResult(result, options, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);

      if (options.isPartial) {
        text.setText(theme.fg("muted", "Running Grok Build…"));
        return text;
      }

      if (context.isError || !result.details) {
        const raw = result.content.find((content) => content.type === "text")?.text ?? "";
        text.setText(theme.fg("error", raw));
        return text;
      }

      const details = result.details as GrokBuildDetails;
      const output = result.content.find((content) => content.type === "text")?.text ?? "";
      const lines = output.split("\n").filter(Boolean);
      const shown = lines.slice(0, options.expanded ? lines.length : 8);
      const remaining = lines.length - shown.length;
      let body = shown.length > 0 ? `\n${shown.map((line) => theme.fg("toolOutput", line)).join("\n")}` : "";
      if (remaining > 0) {
        body += theme.fg("muted", `\n… (${remaining} more lines, `) + keyHint("app.tools.expand", "to expand") + theme.fg("muted", ")");
      }

      text.setText(theme.fg("success", "✓ Grok Build") + theme.fg("muted", ` · exit ${details.exitCode}`) + body);
      return text;
    },
  });
}
