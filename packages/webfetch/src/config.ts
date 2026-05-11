export interface CacheConfig {
	maxSizeBytes: number;
	ttlMs: number;
}

export interface WebFetchConfig {
	/**
	 * Default maximum chars returned per paginated page.
	 * Default: 20000
	 */
	maxPageLength: number;
	cache: CacheConfig;
	/**
	 * Enable built-in fetch optimizations for sites that are difficult to read
	 * through generic HTML extraction. Default: true.
	 */
	optimizations: boolean;
}

export const DEFAULT_CONFIG: WebFetchConfig = {
	maxPageLength: 20000,
	cache: {
		maxSizeBytes: 50 * 1024 * 1024,
		ttlMs: 15 * 60 * 1000,
	},
	optimizations: true,
};

export function mergeConfig(partial?: Partial<WebFetchConfig>): WebFetchConfig {
	if (!partial) return DEFAULT_CONFIG;
	return {
		maxPageLength: partial.maxPageLength ?? DEFAULT_CONFIG.maxPageLength,
		cache: { ...DEFAULT_CONFIG.cache, ...partial.cache },
		optimizations: partial.optimizations ?? DEFAULT_CONFIG.optimizations,
	};
}

export function loadWebFetchConfig(settings: Record<string, unknown> = {}): WebFetchConfig {
	const webfetch = settings.webfetch;
	if (typeof webfetch !== "object" || webfetch === null || Array.isArray(webfetch)) {
		return mergeConfig();
	}

	const optimizations = (webfetch as Record<string, unknown>).optimizations;
	return mergeConfig({
		optimizations: typeof optimizations === "boolean" ? optimizations : undefined,
	});
}
