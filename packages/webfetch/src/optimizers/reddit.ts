import type { FetchOptimizer } from "./types.js";

function isRedditHost(hostname: string): boolean {
	return hostname === "reddit.com" || hostname === "www.reddit.com";
}

export const redditOptimizer: FetchOptimizer = {
	id: "reddit",
	match(url) {
		try {
			return isRedditHost(new URL(url).hostname.toLowerCase());
		} catch {
			return false;
		}
	},
	rewriteUrl(url) {
		const parsed = new URL(url);
		parsed.hostname = "old.reddit.com";
		return parsed.toString();
	},
};
