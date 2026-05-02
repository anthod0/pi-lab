import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerWebSearchTool } from "./tool.js";

/**
 * WebSearch extension for pi coding agent.
 *
 * Registers the `websearch` tool, backed by Exa Search API.
 * Requires EXA_API_KEY in the environment.
 */
export default function (pi: ExtensionAPI) {
  registerWebSearchTool(pi);
}

export { registerWebSearchTool } from "./tool.js";
export { searchExa, normalizeParams, buildExaRequest, parseExaResponse } from "./exa.js";
export type { WebSearchParams, NormalizedWebSearchParams, SearchDetails, NormalizedSearchResult } from "./exa.js";
