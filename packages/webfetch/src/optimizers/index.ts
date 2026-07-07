import type { WebFetchConfig } from "../config.js";
import { normalizeUrl } from "../normalize.js";
import { xOptimizer } from "./x.js";
import type {
	FetchOptimizationResult,
	FetchOptimizer,
	ProcessHtmlWithOptimizationsInput,
} from "./types.js";

const BUILT_IN_OPTIMIZERS: FetchOptimizer[] = [xOptimizer];

function findOptimizer(url: string, config: WebFetchConfig): FetchOptimizer | undefined {
	if (!config.optimizations) return undefined;
	return BUILT_IN_OPTIMIZERS.find((optimizer) => optimizer.match(url));
}

export function applyFetchOptimizations(
	url: string,
	config: WebFetchConfig,
): FetchOptimizationResult {
	const optimizer = findOptimizer(url, config);
	if (!optimizer?.rewriteUrl) return { url };

	const rewritten = optimizer.rewriteUrl(url);
	if (!rewritten || rewritten === url) return { url };

	return {
		url: normalizeUrl(rewritten),
		optimizerId: optimizer.id,
	};
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
