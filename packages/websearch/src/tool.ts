import { Type } from "@sinclair/typebox";
import { type ExtensionAPI, keyHint } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { searchExa, type SearchDetails, type WebSearchParams } from "./exa.js";

export interface WebSearchToolOptions {
  env?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
}

export function registerWebSearchTool(pi: ExtensionAPI, options: WebSearchToolOptions = {}): void {
  const env = options.env ?? process.env;
  const fetcher = options.fetcher ?? fetch;

  pi.registerTool({
    name: "websearch",
    label: "Web Search",
    description: "Search the web with Exa and return concise, citation-friendly results.",
    promptSnippet: "Search the web with Exa for concise citation-friendly results",
    promptGuidelines: [
      "Use websearch when current or external information is needed.",
      "Prefer natural-language search queries over short keyword-only queries.",
      "Use include_domains when the user asks for official or source-specific results.",
      "Use category: \"news\" or published-date filters for recent/current events.",
      "Keep type as auto unless speed or deeper research is explicitly useful.",
      "Use webfetch on a result URL when you need to read the full page content.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Natural-language web search query." }),
      num_results: Type.Optional(
        Type.Number({ description: "Number of results to return. Defaults to 5. Must be an integer from 1 to 20." }),
      ),
      type: Type.Optional(
        Type.Union([
          Type.Literal("auto"),
          Type.Literal("fast"),
          Type.Literal("instant"),
          Type.Literal("deep-lite"),
          Type.Literal("deep"),
        ], { description: "Exa search type. Defaults to auto." }),
      ),
      category: Type.Optional(
        Type.Union([
          Type.Literal("news"),
          Type.Literal("research paper"),
          Type.Literal("company"),
          Type.Literal("people"),
          Type.Literal("personal site"),
          Type.Literal("financial report"),
        ], { description: "Optional Exa category filter." }),
      ),
      include_domains: Type.Optional(Type.Array(Type.String(), { description: "Only include results from these domains." })),
      exclude_domains: Type.Optional(Type.Array(Type.String(), { description: "Exclude results from these domains." })),
      start_published_date: Type.Optional(Type.String({ description: "Only include results published on or after this ISO 8601 date." })),
      end_published_date: Type.Optional(Type.String({ description: "Only include results published on or before this ISO 8601 date." })),
      fresh: Type.Optional(Type.Boolean({ description: "When true, request the freshest Exa highlights with contents.maxAgeHours=0." })),
    }),

    async execute(_toolCallId, params) {
      const apiKey = env.EXA_API_KEY;
      if (!apiKey) {
        throw new Error("EXA_API_KEY must be configured to use websearch. Set it in your environment or load it with @pi-lab/env.");
      }

      const { markdown, details } = await searchExa(params as WebSearchParams, apiKey, fetcher);
      return {
        content: [{ type: "text", text: markdown }],
        details,
      };
    },

    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      let line = theme.fg("toolTitle", theme.bold("websearch "));
      line += theme.fg("accent", args.query ?? "");
      if (args.type && args.type !== "auto") line += theme.fg("muted", ` · ${args.type}`);
      if (args.num_results) line += theme.fg("dim", ` · ${args.num_results} results`);
      text.setText(line);
      return text;
    },

    renderResult(result, options, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);

      if (options.isPartial) {
        text.setText(theme.fg("muted", "Searching…"));
        return text;
      }

      if (context.isError || !result.details) {
        const raw = result.content.find((content) => content.type === "text")?.text ?? "";
        text.setText(theme.fg("error", raw));
        return text;
      }

      const details = result.details as SearchDetails;
      const topResults = details.results.slice(0, options.expanded ? details.results.length : 5);
      const header = theme.fg("success", `✓ ${details.resultCount} results`) + theme.fg("muted", ` · ${details.type}`);
      const rows = topResults.map((item, index) => {
        const title = item.title || item.url;
        const highlights = options.expanded && item.highlights.length > 0
          ? `\n${item.highlights.slice(0, 3).map((highlight) => theme.fg("toolOutput", `     - ${highlight}`)).join("\n")}`
          : "";
        return `${theme.fg("dim", `${index + 1}.`)} ${theme.fg("accent", title)} ${theme.fg("dim", item.url)}${highlights}`;
      });

      let body = rows.length > 0 ? `\n${rows.join("\n")}` : "";
      const remaining = details.results.length - topResults.length;
      if (remaining > 0) {
        body += theme.fg("muted", `\n… (${remaining} more results, `) + keyHint("app.tools.expand", "to expand") + theme.fg("muted", ")");
      }

      text.setText(header + body);
      return text;
    },
  });
}
