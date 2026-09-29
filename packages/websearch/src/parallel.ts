import { formatSearchResults } from "./format.js";
import {
  normalizeParams,
  type NormalizedSearchResult,
  type NormalizedWebSearchParams,
  type SearchDetails,
  type WebSearchParams,
  type WebSearchType,
} from "./search.js";

export const PARALLEL_SEARCH_URL = "https://api.parallel.ai/v1/search";

type ParallelSearchMode = "turbo" | "fast" | "advanced";

interface ParallelSourcePolicy {
  include_domains?: string[];
  exclude_domains?: string[];
  after_date?: string;
}

interface ParallelAdvancedSettings {
  max_results: number;
  source_policy?: ParallelSourcePolicy;
  fetch_policy?: { max_age_seconds: 600 };
}

export interface ParallelSearchRequest {
  objective: string;
  search_queries: string[];
  mode: ParallelSearchMode;
  advanced_settings: ParallelAdvancedSettings;
}

interface ParallelResult {
  title?: unknown;
  url?: unknown;
  publish_date?: unknown;
  excerpts?: unknown;
}

interface ParallelResponse {
  results?: unknown;
  search_id?: unknown;
  session_id?: unknown;
  warnings?: unknown;
  usage?: unknown;
}

const PARALLEL_MODE_BY_COMMON_TYPE: Record<WebSearchType, ParallelSearchMode> = {
  fast: "turbo",
  balanced: "fast",
  deep: "advanced",
};

export function buildParallelRequest(params: NormalizedWebSearchParams): ParallelSearchRequest {
  const sourcePolicy: ParallelSourcePolicy = {};
  if (params.include_domains?.length) sourcePolicy.include_domains = params.include_domains;
  if (params.exclude_domains?.length) sourcePolicy.exclude_domains = params.exclude_domains;
  if (params.start_published_date) sourcePolicy.after_date = params.start_published_date;

  const advancedSettings: ParallelAdvancedSettings = { max_results: params.num_results };
  if (Object.keys(sourcePolicy).length > 0) advancedSettings.source_policy = sourcePolicy;
  if (params.fresh) advancedSettings.fetch_policy = { max_age_seconds: 600 };

  return {
    objective: params.query,
    search_queries: [params.query],
    mode: PARALLEL_MODE_BY_COMMON_TYPE[params.type],
    advanced_settings: advancedSettings,
  };
}

export function parseParallelResponse(response: unknown): Omit<SearchDetails, "provider" | "query" | "type"> {
  if (!isObject(response) || !Array.isArray((response as ParallelResponse).results)) {
    throw new Error("Malformed Parallel response: expected a results array");
  }

  const parallelResponse = response as ParallelResponse;
  const results = (parallelResponse.results as ParallelResult[]).map(normalizeResult);
  const raw: Record<string, unknown> = {};
  if (typeof parallelResponse.search_id === "string") raw.searchId = parallelResponse.search_id;
  if (typeof parallelResponse.session_id === "string") raw.sessionId = parallelResponse.session_id;
  if (Array.isArray(parallelResponse.warnings) && parallelResponse.warnings.length > 0) {
    raw.warnings = parallelResponse.warnings;
  }
  if (Array.isArray(parallelResponse.usage)) raw.usage = parallelResponse.usage;

  return {
    resultCount: results.length,
    results,
    ...(Object.keys(raw).length > 0 ? { raw } : {}),
  };
}

export async function searchParallel(
  params: WebSearchParams,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<{ markdown: string; details: SearchDetails }> {
  const normalized = normalizeParams(params);
  const request = buildParallelRequest(normalized);

  const response = await fetcher(PARALLEL_SEARCH_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
  });

  const body = await parseResponseBody(response);
  if (!response.ok) {
    throw new Error(`Parallel search failed with status ${response.status}: ${sanitizeErrorMessage(extractErrorMessage(body, response.statusText), apiKey)}`);
  }

  const parsed = parseParallelResponse(body);
  const details: SearchDetails = {
    provider: "parallel",
    query: normalized.query,
    type: normalized.type,
    ...parsed,
  };

  return { markdown: formatSearchResults(details), details };
}

function normalizeResult(result: ParallelResult): NormalizedSearchResult {
  if (!isObject(result)) throw new Error("Malformed Parallel response: result must be an object");
  if (typeof result.url !== "string" || result.url.trim() === "") {
    throw new Error("Malformed Parallel response: result is missing url");
  }

  const highlights = Array.isArray(result.excerpts)
    ? result.excerpts.filter((excerpt): excerpt is string => typeof excerpt === "string" && excerpt.trim() !== "")
    : [];

  const normalized: NormalizedSearchResult = {
    title: typeof result.title === "string" && result.title.trim() ? result.title.trim() : result.url,
    url: result.url,
    highlights,
  };
  if (typeof result.publish_date === "string" && result.publish_date.trim()) {
    normalized.publishedDate = result.publish_date;
  }
  return normalized;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const bodyText = await response.text();
  try {
    return bodyText ? JSON.parse(bodyText) : {};
  } catch {
    if (!response.ok) throw new Error(`Parallel search failed with status ${response.status}: ${response.statusText}`);
    throw new Error("Malformed Parallel response: response body is not valid JSON");
  }
}

function extractErrorMessage(body: unknown, fallback: string): string {
  if (isObject(body)) {
    const error = body.error;
    if (isObject(error) && typeof error.message === "string" && error.message.trim()) return error.message.trim();
    for (const key of ["message", "detail"] as const) {
      const value = body[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return fallback || "request failed";
}

function sanitizeErrorMessage(message: string, apiKey: string): string {
  return message.split(apiKey).join("[redacted]");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
