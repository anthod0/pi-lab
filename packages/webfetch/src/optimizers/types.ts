import type { ContentProcessResult } from "../content.js";
import type { WebFetchConfig } from "../config.js";

export interface FetchOptimizationResult {
	url: string;
	cacheKey: string;
	optimizerId?: string;
}

export interface OptimizedFetchInput {
	url: string;
	signal?: AbortSignal;
}

export interface OptimizedFetchResult extends ContentProcessResult {
	/** URL shown to the caller after site-specific canonicalization. */
	url: string;
	/** Optional cache lifetime override for this result. */
	ttlMs?: number;
}

export interface HtmlOptimizationInput {
	url: string;
	html: string;
	defaultProcess: () => Promise<ContentProcessResult>;
}

export interface FetchOptimizer {
	id: string;
	match(url: string): boolean;
	cacheKey?(url: string): string | undefined;
	rewriteUrl?(url: string): string | undefined;
	fetch?(input: OptimizedFetchInput): Promise<OptimizedFetchResult>;
	processHtml?(input: HtmlOptimizationInput): Promise<ContentProcessResult | undefined>;
}

export interface ProcessHtmlWithOptimizationsInput {
	url: string;
	html: string;
	config: WebFetchConfig;
	defaultProcess: () => Promise<ContentProcessResult>;
}
