import { formatSearchResults } from "./format.js";
import {
  normalizeParams,
  type NormalizedSearchResult,
  type NormalizedWebSearchParams,
  type SearchDetails,
  type WebSearchParams,
  type WebSearchType,
} from "./search.js";

export const EXA_SEARCH_URL = "https://api.exa.ai/search";

type ExaSearchType = "instant" | "auto" | "deep";

export interface ExaSearchRequest {
  query: string;
  type: ExaSearchType;
  numResults: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string;
  contents: {
    highlights: true;
    maxAgeHours: 0;
  };
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

const EXA_TYPE_BY_COMMON_TYPE: Record<WebSearchType, ExaSearchType> = {
  fast: "instant",
  balanced: "auto",
  deep: "deep",
};

export function buildExaRequest(params: NormalizedWebSearchParams): ExaSearchRequest {
  const request: ExaSearchRequest = {
    query: params.query,
    type: EXA_TYPE_BY_COMMON_TYPE[params.type],
    numResults: params.num_results,
    contents: { highlights: true, maxAgeHours: 0 },
  };

  if (params.include_domains?.length) request.includeDomains = params.include_domains;
  if (params.exclude_domains?.length) request.excludeDomains = params.exclude_domains;
  if (params.start_published_date) request.startPublishedDate = params.start_published_date;

  return request;
}

export function parseExaResponse(response: unknown): Omit<SearchDetails, "provider" | "query" | "type"> {
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

  const body = await parseResponseBody(response, "Exa");
  if (!response.ok) {
    throw new Error(`Exa search failed with status ${response.status}: ${sanitizeErrorMessage(extractErrorMessage(body, response.statusText), apiKey)}`);
  }

  const parsed = parseExaResponse(body);
  const details: SearchDetails = {
    provider: "exa",
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

async function parseResponseBody(response: Response, provider: string): Promise<unknown> {
  const bodyText = await response.text();
  try {
    return bodyText ? JSON.parse(bodyText) : {};
  } catch {
    if (!response.ok) throw new Error(`${provider} search failed with status ${response.status}: ${response.statusText}`);
    throw new Error(`Malformed ${provider} response: response body is not valid JSON`);
  }
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
