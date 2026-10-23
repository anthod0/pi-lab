import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isNativeWebSearchEnabled, loadConfig, type OpenAIConfig } from "./native-search.js";
import { registerWebSearchTool, type WebSearchToolOptions } from "./tool.js";

const RESTORE_ENTRY = "pi-lab:websearch-restore";

export default function (pi: ExtensionAPI, options: WebSearchToolOptions = {}) {
  let openaiConfig: OpenAIConfig | undefined;
  let registered = false;
  let hidden = false;
  let restoreActive = options.defaultActive ?? true;

  function savePreference(): void {
    pi.appendEntry(RESTORE_ENTRY, { active: restoreActive });
  }

  function updateTool(ctx: ExtensionContext): void {
    if (isNativeWebSearchEnabled(openaiConfig, ctx)) {
      if (registered && !hidden) {
        restoreActive = pi.getActiveTools().includes("websearch");
        savePreference();
        registerWebSearchTool(pi, { ...options, exposure: "hidden" });
        hidden = true;
      }
    } else if (!registered || hidden) {
      registerWebSearchTool(pi, { ...options, exposure: "direct", defaultActive: restoreActive });
      registered = true;
      hidden = false;
    }
  }

  pi.on("session_start", (_event, ctx) => {
    restoreActive = options.defaultActive ?? true;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== RESTORE_ENTRY) continue;
      const data = entry.data as { active?: unknown } | undefined;
      if (typeof data?.active === "boolean") restoreActive = data.active;
    }
    openaiConfig = undefined;
    try {
      openaiConfig = loadConfig(ctx.cwd, options.home);
    } finally {
      // A broken OpenAI config disables native search, not the independent provider.
      updateTool(ctx);
    }
  });
  pi.on("before_agent_start", (_event, ctx) => updateTool(ctx));
  // Pi captures the next turn's tool declarations BEFORE turn_start. Update at the
  // preceding turn boundary, after its tools finish, so declarations and execution agree.
  pi.on("turn_end", (_event, ctx) => updateTool(ctx));
  pi.on("session_compact", (_event, ctx) => updateTool(ctx));
  pi.on("session_compact_failed", (_event, ctx) => updateTool(ctx));
  pi.on("session_shutdown", () => {
    if (!registered) return;
    if (!hidden) restoreActive = pi.getActiveTools().includes("websearch");
    savePreference();
  });
}

export { readWebSearchProvider, resolveWebSearchProvider } from "./config.js";
export { searchExa, buildExaRequest, parseExaResponse } from "./exa.js";
export { searchParallel, buildParallelRequest, parseParallelResponse } from "./parallel.js";
export { searchTinyfish, buildTinyfishRequest, parseTinyfishResponse } from "./tinyfish.js";
export { normalizeParams } from "./search.js";
export { registerWebSearchTool } from "./tool.js";
export type {
  NormalizedSearchResult,
  NormalizedWebSearchParams,
  SearchDetails,
  WebSearchParams,
  WebSearchProvider,
  WebSearchType,
} from "./search.js";
