import { Type } from "@sinclair/typebox";
import { type ExtensionAPI, keyHint } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { readMergedPiSettings, type PiSettings } from "@pi-lab/utils";
import { loadXSearchConfig, searchX, type XSearchDetails, type XSearchParams } from "./xai.js";

export interface XSearchToolOptions {
  env?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
  settings?: PiSettings;
}

export function registerXSearchTool(pi: ExtensionAPI, options: XSearchToolOptions = {}): void {
  const env = options.env ?? process.env;
  const fetcher = options.fetcher ?? fetch;
  const settings = options.settings ?? readMergedPiSettings();
  const config = loadXSearchConfig(settings);

  pi.registerTool({
    name: "xsearch",
    label: "X Search",
    description: "Search X/Twitter with xAI Grok and return an answer with citation URLs.",
    promptSnippet: "Search X/Twitter with xAI Grok for realtime social posts and citation URLs",
    promptGuidelines: [
      "Use xsearch when the user needs current discussion or sentiment from X/Twitter.",
      "Use allowed_x_handles when the user asks to search specific X accounts.",
      "Use excluded_x_handles when the user asks to exclude specific X accounts.",
      "Use from_date and to_date for date ranges; dates must be YYYY-MM-DD.",
      "Do not use xsearch as a raw tweet API; it returns Grok's answer and citation URLs, not guaranteed original post objects.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Natural-language X/Twitter search query." }),
      allowed_x_handles: Type.Optional(Type.Array(Type.String(), { description: "Only consider posts from these X handles (max 10). Do not include @." })),
      excluded_x_handles: Type.Optional(Type.Array(Type.String(), { description: "Exclude posts from these X handles (max 10). Do not include @." })),
      from_date: Type.Optional(Type.String({ description: "Start date for search range, YYYY-MM-DD." })),
      to_date: Type.Optional(Type.String({ description: "End date for search range, YYYY-MM-DD." })),
    }),

    async execute(_toolCallId, params) {
      const apiKey = env.XAI_API_KEY;
      if (!apiKey) {
        throw new Error("XAI_API_KEY must be configured to use xsearch. Set it in your environment or load it with @pi-lab/env.");
      }

      const { markdown, details } = await searchX(params as XSearchParams, config, apiKey, fetcher);
      return {
        content: [{ type: "text", text: markdown }],
        details,
      };
    },

    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      let line = theme.fg("toolTitle", theme.bold("xsearch "));
      line += theme.fg("accent", args.query ?? "");
      const handles = args.allowed_x_handles ?? args.excluded_x_handles;
      if (Array.isArray(handles) && handles.length > 0) line += theme.fg("muted", ` · ${handles.map((handle) => `@${handle}`).join(",")}`);
      if (args.from_date || args.to_date) line += theme.fg("dim", ` · ${args.from_date ?? "…"}..${args.to_date ?? "…"}`);
      text.setText(line);
      return text;
    },

    renderResult(result, options, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);

      if (options.isPartial) {
        text.setText(theme.fg("muted", "Searching X…"));
        return text;
      }

      if (context.isError || !result.details) {
        const raw = result.content.find((content) => content.type === "text")?.text ?? "";
        text.setText(theme.fg("error", raw));
        return text;
      }

      const details = result.details as XSearchDetails;
      const header = theme.fg("success", `✓ X search`) + theme.fg("muted", ` · ${details.citations.length} citations · ${details.xSearchCalls ?? 0} calls`);
      const sources = details.citations.slice(0, options.expanded ? details.citations.length : 5);
      const rows = sources.map((url, index) => `${theme.fg("dim", `${index + 1}.`)} ${theme.fg("accent", url)}`);
      let body = rows.length > 0 ? `\n${rows.join("\n")}` : "";
      const remaining = details.citations.length - sources.length;
      if (remaining > 0) {
        body += theme.fg("muted", `\n… (${remaining} more citations, `) + keyHint("app.tools.expand", "to expand") + theme.fg("muted", ")");
      }

      text.setText(header + body);
      return text;
    },
  });
}
