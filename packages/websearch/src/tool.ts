import { Type } from "@sinclair/typebox";
import { type ExtensionAPI, keyHint } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { readWebSearchProvider } from "./config.js";
import { searchExa } from "./exa.js";
import { searchParallel } from "./parallel.js";
import type { SearchDetails, WebSearchParams, WebSearchProvider } from "./search.js";
import { searchTinyfish } from "./tinyfish.js";

export interface WebSearchToolOptions {
  env?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
  home?: string;
  provider?: WebSearchProvider;
}

export function registerWebSearchTool(pi: ExtensionAPI, options: WebSearchToolOptions = {}): void {
  const env = options.env ?? process.env;
  const fetcher = options.fetcher ?? fetch;

  pi.registerTool({
    name: "websearch",
    label: "Web Search",
    description: "Search the web and return concise, citation-friendly results.",
    parameters: Type.Object({
      query: Type.String({ description: "Natural-language web search query." }),
      num_results: Type.Optional(
        Type.Number({ description: "Number of results to return. Defaults to 5. Must be an integer from 1 to 20." }),
      ),
      type: Type.Optional(
        Type.Union([
          Type.Literal("fast"),
          Type.Literal("balanced"),
          Type.Literal("deep"),
        ], { description: "Provider-neutral search depth. Defaults to balanced." }),
      ),
      include_domains: Type.Optional(Type.Array(Type.String(), { description: "Only include results from these domains." })),
      exclude_domains: Type.Optional(Type.Array(Type.String(), { description: "Exclude results from these domains." })),
      start_published_date: Type.Optional(Type.String({ description: "Only include results published on or after this ISO 8601 date." })),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const provider = options.provider ?? readWebSearchProvider({
        cwd: ctx.cwd,
        projectTrusted: ctx.isProjectTrusted(),
        env,
        home: options.home,
      });
      const providerConfig = {
        exa: { apiKeyName: "EXA_API_KEY", search: searchExa },
        parallel: { apiKeyName: "PARALLEL_API_KEY", search: searchParallel },
        tinyfish: { apiKeyName: "TINYFISH_API_KEY", search: searchTinyfish },
      } satisfies Record<WebSearchProvider, {
        apiKeyName: string;
        search: typeof searchExa;
      }>;
      const { apiKeyName, search } = providerConfig[provider];
      const apiKey = env[apiKeyName];
      if (!apiKey) {
        throw new Error(`${apiKeyName} must be configured to use websearch with ${provider}. Set it in your environment or load it with @pi-lab/env.`);
      }

      const { markdown, details } = await search(params as WebSearchParams, apiKey, fetcher);
      return {
        content: [{ type: "text", text: markdown }],
        details,
      };
    },

    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      let line = theme.fg("toolTitle", theme.bold("websearch "));
      line += theme.fg("accent", args.query ?? "");
      if (args.type && args.type !== "balanced") line += theme.fg("muted", ` · ${args.type}`);
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
      const header = theme.fg("success", `✓ ${details.resultCount} results`) + theme.fg("muted", ` · ${details.provider} · ${details.type}`);
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
