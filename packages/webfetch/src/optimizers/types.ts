import type { ContentProcessResult } from "../content.js";
import type { WebFetchConfig } from "../config.js";

export interface FetchOptimizationResult {
	url: string;
	optimizerId?: string;
}

export interface HtmlOptimizationInput {
	url: string;
	html: string;
	defaultProcess: () => Promise<ContentProcessResult>;
}

export interface FetchOptimizer {
	id: string;
	match(url: string): boolean;
	rewriteUrl?(url: string): string | undefined;
	processHtml?(input: HtmlOptimizationInput): Promise<ContentProcessResult | undefined>;
}

export interface ProcessHtmlWithOptimizationsInput {
	url: string;
	html: string;
	config: WebFetchConfig;
	defaultProcess: () => Promise<ContentProcessResult>;
}
