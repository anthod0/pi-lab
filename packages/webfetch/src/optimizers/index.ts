import type { WebFetchConfig } from "../config.js";
import { normalizeUrl } from "../normalize.js";
import { redditOptimizer } from "./reddit.js";
import { xOptimizer } from "./x.js";
import type {
	FetchOptimizationResult,
	FetchOptimizer,
	OptimizedFetchResult,
	ProcessHtmlWithOptimizationsInput,
} from "./types.js";

const BUILT_IN_OPTIMIZERS: FetchOptimizer[] = [redditOptimizer, xOptimizer];

function findOptimizer(url: string, config: WebFetchConfig): FetchOptimizer | undefined {
	if (!config.optimizations) return undefined;
	return BUILT_IN_OPTIMIZERS.find((optimizer) => optimizer.match(url));
}

export function applyFetchOptimizations(
	url: string,
	config: WebFetchConfig,
): FetchOptimizationResult {
	const optimizer = findOptimizer(url, config);
	const cacheKey = optimizer?.cacheKey?.(url) ?? url;
	if (!optimizer?.rewriteUrl) {
		return { url, cacheKey, optimizerId: optimizer?.id };
	}

	const rewritten = optimizer.rewriteUrl(url);
	if (!rewritten || rewritten === url) {
		return { url, cacheKey, optimizerId: optimizer.id };
	}

	return {
		url: normalizeUrl(rewritten),
		cacheKey,
		optimizerId: optimizer.id,
	};
}

export async function fetchWithOptimizations(
	url: string,
	config: WebFetchConfig,
	signal?: AbortSignal,
): Promise<OptimizedFetchResult | undefined> {
	const optimizer = findOptimizer(url, config);
	return optimizer?.fetch?.({ url, signal });
}

export async function processHtmlWithOptimizations({
	url,
	html,
	config,
	defaultProcess,
}: ProcessHtmlWithOptimizationsInput) {
	const optimizer = findOptimizer(url, config);
	if (optimizer?.processHtml) {
		const optimized = await optimizer.processHtml({ url, html, defaultProcess });
		if (optimized) return optimized;
	}

	return defaultProcess();
}

export type { FetchOptimizer } from "./types.js";
