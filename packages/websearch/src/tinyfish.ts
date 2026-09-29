import { formatSearchResults } from "./format.js";
import {
  normalizeParams,
  type NormalizedSearchResult,
  type NormalizedWebSearchParams,
  type SearchDetails,
  type WebSearchParams,
} from "./search.js";

export const TINYFISH_SEARCH_URL = "https://api.search.tinyfish.ai";

const TINYFISH_PAGE_SIZE = 10;

export interface TinyfishSearchRequest {
  query: string;
  include_domains?: string;
  exclude_domains?: string;
  after_date?: string;
  page: number;
}

interface TinyfishResult {
  title?: unknown;
  url?: unknown;
  snippet?: unknown;
  date?: unknown;
  publisher?: unknown;
}

interface TinyfishResponse {
  query?: unknown;
  results?: unknown;
  total_results?: unknown;
  page?: unknown;
}

export function buildTinyfishRequest(
  params: NormalizedWebSearchParams,
  page = 0,
): TinyfishSearchRequest {
  const request: TinyfishSearchRequest = {
    query: params.query,
    page,
  };

  if (params.include_domains?.length) request.include_domains = params.include_domains.join(",");
  if (params.exclude_domains?.length) request.exclude_domains = params.exclude_domains.join(",");
  if (params.start_published_date) {
    request.after_date = params.start_published_date.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
      ?? params.start_published_date;
  }

  return request;
}

export function parseTinyfishResponse(response: unknown): Omit<SearchDetails, "provider" | "query" | "type"> {
  if (!isObject(response) || !Array.isArray((response as TinyfishResponse).results)) {
    throw new Error("Malformed TinyFish response: expected a results array");
  }

  const tinyfishResponse = response as TinyfishResponse;
  const results = (tinyfishResponse.results as TinyfishResult[]).map(normalizeResult);
  const raw: Record<string, unknown> = {};
  if (typeof tinyfishResponse.total_results === "number") raw.totalResults = tinyfishResponse.total_results;
  if (typeof tinyfishResponse.page === "number") raw.page = tinyfishResponse.page;

  return {
    resultCount: results.length,
    results,
    ...(Object.keys(raw).length > 0 ? { raw } : {}),
  };
}

export async function searchTinyfish(
  params: WebSearchParams,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<{ markdown: string; details: SearchDetails }> {
  const normalized = normalizeParams(params);
  const results: NormalizedSearchResult[] = [];
  const pages: Array<{ page: number; totalResults?: number }> = [];

  for (let page = 0; page <= 10 && results.length < normalized.num_results; page += 1) {
    const request = buildTinyfishRequest(normalized, page);
    const url = new URL(TINYFISH_SEARCH_URL);
    for (const [name, value] of Object.entries(request)) url.searchParams.set(name, String(value));

    const response = await fetcher(url, {
      method: "GET",
      headers: { "X-API-Key": apiKey },
    });

    const body = await parseResponseBody(response);
    if (!response.ok) {
      throw new Error(`TinyFish search failed with status ${response.status}: ${sanitizeErrorMessage(extractErrorMessage(body, response.statusText), apiKey)}`);
    }

    const parsed = parseTinyfishResponse(body);
    results.push(...parsed.results);
    pages.push({
      page,
      ...(typeof parsed.raw?.totalResults === "number" ? { totalResults: parsed.raw.totalResults } : {}),
    });

    if (parsed.results.length < TINYFISH_PAGE_SIZE) break;
  }

  const selectedResults = results.slice(0, normalized.num_results);
  const details: SearchDetails = {
    provider: "tinyfish",
    query: normalized.query,
    type: normalized.type,
    resultCount: selectedResults.length,
    results: selectedResults,
    raw: { pages },
  };

  return { markdown: formatSearchResults(details), details };
}

function normalizeResult(result: TinyfishResult): NormalizedSearchResult {
  if (!isObject(result)) throw new Error("Malformed TinyFish response: result must be an object");
  if (typeof result.url !== "string" || result.url.trim() === "") {
    throw new Error("Malformed TinyFish response: result is missing url");
  }

  const normalized: NormalizedSearchResult = {
    title: typeof result.title === "string" && result.title.trim() ? result.title.trim() : result.url,
    url: result.url,
    highlights: typeof result.snippet === "string" && result.snippet.trim() ? [result.snippet.trim()] : [],
  };

  if (typeof result.date === "string" && result.date.trim()) normalized.publishedDate = result.date;
  if (typeof result.publisher === "string" && result.publisher.trim()) normalized.author = result.publisher;
  return normalized;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const bodyText = await response.text();
  try {
    return bodyText ? JSON.parse(bodyText) : {};
  } catch {
    if (!response.ok) throw new Error(`TinyFish search failed with status ${response.status}: ${response.statusText}`);
    throw new Error("Malformed TinyFish response: response body is not valid JSON");
  }
}

function extractErrorMessage(body: unknown, fallback: string): string {
  if (isObject(body)) {
    const error = body.error;
    if (isObject(error) && typeof error.message === "string" && error.message.trim()) return error.message.trim();
    for (const key of ["error", "message", "detail"] as const) {
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
