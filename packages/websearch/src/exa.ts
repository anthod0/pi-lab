import { formatSearchResults } from "./format.js";

export const EXA_SEARCH_URL = "https://api.exa.ai/search";

export type WebSearchType = "auto" | "fast" | "instant" | "deep-lite" | "deep";
export type WebSearchCategory =
  | "news"
  | "research paper"
  | "company"
  | "people"
  | "personal site"
  | "financial report";

export interface WebSearchParams {
  query: string;
  num_results?: number;
  type?: WebSearchType;
  category?: WebSearchCategory;
  include_domains?: string[];
  exclude_domains?: string[];
  start_published_date?: string;
  end_published_date?: string;
  fresh?: boolean;
}

export interface NormalizedWebSearchParams extends WebSearchParams {
  query: string;
  num_results: number;
  type: WebSearchType;
  fresh: boolean;
}

export interface ExaSearchRequest {
  query: string;
  type: WebSearchType;
  numResults: number;
  category?: WebSearchCategory;
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
  contents: {
    highlights: true;
    maxAgeHours?: 0;
  };
}

export interface NormalizedSearchResult {
  title: string;
  url: string;
  publishedDate?: string;
  author?: string;
  highlights: string[];
  text?: string;
}

export interface SearchDetails {
  query: string;
  type: WebSearchType;
  resultCount: number;
  results: NormalizedSearchResult[];
  raw?: Record<string, unknown>;
}

interface ExaResult {
  title?: unknown;
  url?: unknown;
  publishedDate?: unknown;
  author?: unknown;
  highlights?: unknown;
  text?: unknown;
  summary?: unknown;
}

interface ExaResponse {
  results?: unknown;
  requestId?: unknown;
  autopromptString?: unknown;
}

export function normalizeParams(params: WebSearchParams): NormalizedWebSearchParams {
  const query = params.query?.trim();
  if (!query) throw new Error("websearch query must not be empty");

  const numResults = params.num_results ?? 5;
  if (!Number.isInteger(numResults)) throw new Error("websearch num_results must be an integer");
  if (numResults < 1 || numResults > 20) {
    throw new Error("websearch num_results must be between 1 and 20");
  }

  return {
    ...params,
    query,
    num_results: numResults,
    type: params.type ?? "auto",
    fresh: params.fresh ?? false,
  };
}

export function buildExaRequest(params: NormalizedWebSearchParams): ExaSearchRequest {
  const request: ExaSearchRequest = {
    query: params.query,
    type: params.type,
    numResults: params.num_results,
    contents: { highlights: true },
  };

  if (params.category) request.category = params.category;
  if (params.include_domains?.length) request.includeDomains = params.include_domains;
  if (params.exclude_domains?.length) request.excludeDomains = params.exclude_domains;
  if (params.start_published_date) request.startPublishedDate = params.start_published_date;
  if (params.end_published_date) request.endPublishedDate = params.end_published_date;
  if (params.fresh) request.contents.maxAgeHours = 0;

  return request;
}

export function parseExaResponse(response: unknown): Omit<SearchDetails, "query" | "type"> {
  if (!isObject(response) || !Array.isArray((response as ExaResponse).results)) {
    throw new Error("Malformed Exa response: expected a results array");
  }

  const exaResponse = response as ExaResponse;
  const results = (exaResponse.results as ExaResult[]).map(normalizeResult);
  const raw: Record<string, unknown> = {};
  if (typeof exaResponse.requestId === "string") raw.requestId = exaResponse.requestId;
  if (typeof exaResponse.autopromptString === "string") raw.autopromptString = exaResponse.autopromptString;

  return {
    resultCount: results.length,
    results,
    ...(Object.keys(raw).length > 0 ? { raw } : {}),
  };
}

export async function searchExa(
  params: WebSearchParams,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<{ markdown: string; details: SearchDetails }> {
  const normalized = normalizeParams(params);
  const request = buildExaRequest(normalized);

  const response = await fetcher(EXA_SEARCH_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
  });

  const bodyText = await response.text();
  let body: unknown;
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    if (!response.ok) throw new Error(`Exa search failed with status ${response.status}: ${response.statusText}`);
    throw new Error("Malformed Exa response: response body is not valid JSON");
  }

  if (!response.ok) {
    throw new Error(`Exa search failed with status ${response.status}: ${sanitizeErrorMessage(extractErrorMessage(body, response.statusText), apiKey)}`);
  }

  const parsed = parseExaResponse(body);
  const details: SearchDetails = {
    query: normalized.query,
    type: normalized.type,
    ...parsed,
  };

  return { markdown: formatSearchResults(details), details };
}

function normalizeResult(result: ExaResult): NormalizedSearchResult {
  if (!isObject(result)) throw new Error("Malformed Exa response: result must be an object");
  if (typeof result.url !== "string" || result.url.trim() === "") {
    throw new Error("Malformed Exa response: result is missing url");
  }

  const highlights = Array.isArray(result.highlights)
    ? result.highlights.filter((highlight): highlight is string => typeof highlight === "string" && highlight.trim() !== "")
    : [];

  const normalized: NormalizedSearchResult = {
    title: typeof result.title === "string" && result.title.trim() ? result.title.trim() : result.url,
    url: result.url,
    highlights,
  };

  if (typeof result.publishedDate === "string" && result.publishedDate.trim()) {
    normalized.publishedDate = result.publishedDate;
  }
  if (typeof result.author === "string" && result.author.trim()) normalized.author = result.author;

  const fallbackText = typeof result.text === "string" ? result.text : typeof result.summary === "string" ? result.summary : undefined;
  if (fallbackText?.trim()) normalized.text = fallbackText.trim();

  return normalized;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractErrorMessage(body: unknown, fallback: string): string {
  if (isObject(body)) {
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
