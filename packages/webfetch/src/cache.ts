import { LRUCache } from "lru-cache";
import type { CacheConfig } from "./config.js";
import type { InlineScript } from "./content.js";

export interface CacheEntry {
	markdown: string;
	scripts: InlineScript[];
	url: string;
}

export class WebFetchCache {
	private cache: LRUCache<string, CacheEntry>;

	constructor(config: CacheConfig) {
		this.cache = new LRUCache<string, CacheEntry>({
			maxSize: config.maxSizeBytes,
			sizeCalculation: (value: CacheEntry) => {
				const mdBytes = Buffer.byteLength(value.markdown, "utf8");
				const scriptBytes = value.scripts.reduce(
					(sum, s) => sum + Buffer.byteLength(s.content, "utf8"),
					0,
				);
				return mdBytes + scriptBytes;
			},
			ttl: config.ttlMs,
			allowStale: false,
		});
	}

	get(key: string): CacheEntry | undefined {
		return this.cache.get(key);
	}

	set(key: string, value: CacheEntry, ttlMs?: number): void {
		if (ttlMs === undefined) {
			this.cache.set(key, value);
		} else {
			this.cache.set(key, value, { ttl: ttlMs });
		}
	}

	delete(key: string): void {
		this.cache.delete(key);
	}

	clear(): void {
		this.cache.clear();
	}
}
