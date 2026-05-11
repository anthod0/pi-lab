import type { FetchOptimizer } from "./types.js";

function isXHost(hostname: string): boolean {
	return hostname === "x.com" || hostname === "www.x.com" || hostname === "twitter.com" || hostname === "www.twitter.com";
}

export const xOptimizer: FetchOptimizer = {
	id: "x",
	match(url) {
		try {
			return isXHost(new URL(url).hostname.toLowerCase());
		} catch {
			return false;
		}
	},
	async processHtml() {
		// Placeholder hook: future X optimization can parse inline scripts directly
		// and return a ContentProcessResult here. Returning undefined preserves the
		// existing Readability/Turndown HTML processing path.
		return undefined;
	},
};
