import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readMergedPiSettings } from "@pi-lab/utils";
import { loadWebFetchConfig, mergeConfig } from "./config.js";
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
 * - Built-in fetch optimizations (enabled by default), including X/Twitter post extraction
 * - Pagination via offset/max_length parameters
 */
export default function (pi: ExtensionAPI) {
	const config = loadWebFetchConfig(readMergedPiSettings());
	registerWebFetchTool(pi, config);
}

// Re-export public API for programmatic use
export { loadWebFetchConfig, mergeConfig, DEFAULT_CONFIG } from "./config.js";
export { registerWebFetchTool } from "./tool.js";
export type { WebFetchConfig } from "./config.js";
