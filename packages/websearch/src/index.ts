import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerWebSearchTool } from "./tool.js";

export default function (pi: ExtensionAPI) {
  registerWebSearchTool(pi);
}

export { readWebSearchProvider, resolveWebSearchProvider } from "./config.js";
export { searchExa, buildExaRequest, parseExaResponse } from "./exa.js";
export { searchParallel, buildParallelRequest, parseParallelResponse } from "./parallel.js";
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
