import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mergeConfig } from "./config.js";
import { registerWebFetchTool } from "./tool.js";

/**
 * WebFetch extension for pi coding agent.
 *
 * Registers the `webfetch` tool which fetches URLs and returns Markdown content.
 *
 * Features:
 * - URL normalization (lowercase, http→https, strip default ports)
 * - Same-domain redirect following; cross-domain redirects returned to LLM
 * - Mozilla Readability for HTML → Markdown extraction
 * - Inline script index — use `script=N` to read a specific inline script
 * - LRU cache (50 MB, 15 min TTL) keyed on normalized URL
 * - Pagination via offset/max_length parameters
 */
export default function (pi: ExtensionAPI) {
	const config = mergeConfig();
	registerWebFetchTool(pi, config);
}

// Re-export public API for programmatic use
export { mergeConfig, DEFAULT_CONFIG } from "./config.js";
export { registerWebFetchTool } from "./tool.js";
export type { WebFetchConfig } from "./config.js";
