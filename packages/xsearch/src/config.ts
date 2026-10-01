import type { PiSettings } from "@pi-lab/utils";

import { DEFAULT_MAX_PAGES_CEILING } from "./twitterapi.js";

export const DEFAULT_XSEARCH_MODEL = "grok-4-1-fast-non-reasoning";
export const DEFAULT_MAX_MEDIA_PER_SEARCH = 4;
export const DEFAULT_MAX_PAGES = 5;
/**
 * Unpaid twitterapi.io accounts allow 0.2 QPS (one request every 5 seconds), so
 * this is the safest default both for pacing and for retry backoff. Paid tiers
 * can raise it.
 */
export const DEFAULT_MIN_REQUEST_INTERVAL_MS = 5_000;
export const DEFAULT_RETRY_BASE_DELAY_MS = 5_000;
const MAX_INTERVAL_MS = 600_000;

/**
 * Which backend serves a search.
 *
 * - `auto` (default) prefers xAI when `XAI_API_KEY` is set, otherwise
 *   twitterapi.io when `TWITTERAPI_IO_API_KEY` is set.
 * - Explicit values let a user pin a backend even when both keys exist.
 */
export type XSearchBackend = "auto" | "xai" | "twitterapi";

export interface XSearchConfig {
  /** xAI model that runs `x_search`. Sent verbatim to xAI; never resolved through pi. */
  model: string;
  /**
   * pi model id ("provider/model") that synthesizes the answer from posts
   * retrieved via twitterapi.io. Resolved through pi's model catalogue, so it is
   * a different namespace from `model` and is deliberately a separate key.
   */
  synthesisModel?: string;
  backend: XSearchBackend;
  /** Attach post media to the synthesis request (twitterapi.io backend). */
  enableImageUnderstanding: boolean;
  enableVideoUnderstanding: boolean;
  /** Upper bound on media attachments per search. */
  maxMediaPerSearch: number;
  /** Base page budget per search (twitterapi.io backend). */
  maxPages: number;
  /**
   * Hard ceiling on pages fetched in one search. `maxPages` is clamped to it, so
   * an explicit ceiling can never be exceeded.
   */
  maxPagesCeiling: number;
  /** Minimum spacing between upstream requests (twitterapi.io backend). */
  minRequestIntervalMs: number;
  /** Base delay for retry backoff (twitterapi.io backend). */
  retryBaseDelayMs: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Non-negative finite milliseconds, clamped, or the fallback when absent/invalid. */
function intervalMs(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(value, MAX_INTERVAL_MS) : fallback;
}

/** Positive integer page count, clamped, or the fallback when absent/invalid. */
function pageCount(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? Math.min(value, 100) : fallback;
}

export function loadXSearchConfig(settings: PiSettings): XSearchConfig {
  const config = isObject(settings.xsearch) ? settings.xsearch : {};
  const maxMedia = config.maxMediaPerSearch;
  const ceiling = pageCount(config.maxPagesCeiling, DEFAULT_MAX_PAGES_CEILING);
  const synthesisModel =
    typeof config.synthesisModel === "string" && config.synthesisModel.trim()
      ? config.synthesisModel.trim()
      : undefined;
  return {
    model: typeof config.model === "string" && config.model.trim() ? config.model.trim() : DEFAULT_XSEARCH_MODEL,
    synthesisModel,
    backend:
      config.backend === "xai" || config.backend === "twitterapi" || config.backend === "auto"
        ? config.backend
        : "auto",
    enableImageUnderstanding: config.enableImageUnderstanding === true,
    enableVideoUnderstanding: config.enableVideoUnderstanding === true,
    maxMediaPerSearch:
      typeof maxMedia === "number" && Number.isInteger(maxMedia) && maxMedia >= 0
        ? Math.min(maxMedia, 20)
        : DEFAULT_MAX_MEDIA_PER_SEARCH,
    minRequestIntervalMs: intervalMs(config.minRequestIntervalMs, DEFAULT_MIN_REQUEST_INTERVAL_MS),
    retryBaseDelayMs: intervalMs(config.retryBaseDelayMs, DEFAULT_RETRY_BASE_DELAY_MS),
    maxPages: Math.min(pageCount(config.maxPages, DEFAULT_MAX_PAGES), ceiling),
    maxPagesCeiling: ceiling,
  };
}
