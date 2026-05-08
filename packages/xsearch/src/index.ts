import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerXSearchTool } from "./tool.js";

/**
 * XSearch extension for pi coding agent.
 *
 * Registers the `xsearch` tool, backed by xAI Responses API `x_search`.
 * Requires XAI_API_KEY in the environment.
 */
export default function (pi: ExtensionAPI) {
  registerXSearchTool(pi);
}

export { registerXSearchTool } from "./tool.js";
export {
  DEFAULT_XSEARCH_MODEL,
  XAI_RESPONSES_URL,
  buildXSearchRequest,
  loadXSearchConfig,
  normalizeParams,
  parseXaiResponse,
  searchX,
} from "./xai.js";
export type {
  NormalizedXSearchParams,
  XSearchConfig,
  XSearchDetails,
  XSearchParams,
  XSearchRequest,
} from "./xai.js";
