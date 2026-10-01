import { DEFAULT_XSEARCH_MODEL, loadXSearchConfig, type XSearchBackend, type XSearchConfig } from "./config.js";
import { formatXSearchResults } from "./format.js";

export const XAI_RESPONSES_URL = "https://api.x.ai/v1/responses";

// Re-exported so imports from this module keep working for existing consumers.
export { DEFAULT_XSEARCH_MODEL, loadXSearchConfig };
export type { XSearchBackend, XSearchConfig };

export interface XSearchParams {
  query: string;
  allowed_x_handles?: string[];
  excluded_x_handles?: string[];
  from_date?: string;
  to_date?: string;
}

export interface NormalizedXSearchParams extends XSearchParams {
  query: string;
}

export interface XSearchToolConfig {
  type: "x_search";
  allowed_x_handles?: string[];
  excluded_x_handles?: string[];
  from_date?: string;
  to_date?: string;
  enable_image_understanding?: true;
  enable_video_understanding?: true;
}

export interface XSearchRequest {
  model: string;
  input: Array<{ role: "user"; content: string }>;
  tools: [XSearchToolConfig];
}

export interface XSearchDetails {
  query: string;
  model: string;
  text: string;
  citations: string[];
  xSearchCalls?: number;
  webSearchCalls?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /** Disclosures worth surfacing to the user; rendered as a trailing `## Notes` section. */
  notes?: string[];
  /** Posts xAI reported fetching (`x_posts_fetched`), billed per item. */
  xPostsFetched?: number;
  /** Profiles xAI reported fetching via `x_user_search` (`x_users_fetched`). */
  xUsersFetched?: number;
}

interface XaiUsage {
  input_tokens?: unknown;
  output_tokens?: unknown;
  total_tokens?: unknown;
  server_side_tool_usage_details?: {
    x_search_calls?: unknown;
    web_search_calls?: unknown;
    /** Posts returned by keyword/semantic/thread search (xAI reports this). */
    x_posts_fetched?: unknown;
    /** Profiles returned by xAI's `x_user_search`. */
    x_users_fetched?: unknown;
  };
}

export function normalizeParams(params: XSearchParams): NormalizedXSearchParams {
  const query = params.query?.trim();
  if (!query) throw new Error("xsearch query must not be empty");

  if (params.allowed_x_handles?.length && params.excluded_x_handles?.length) {
    throw new Error("xsearch allowed_x_handles and excluded_x_handles cannot be set together");
  }

  const normalized: NormalizedXSearchParams = { query };
  const allowed = normalizeHandles(params.allowed_x_handles, "allowed_x_handles");
  const excluded = normalizeHandles(params.excluded_x_handles, "excluded_x_handles");
  if (allowed.length > 0) normalized.allowed_x_handles = allowed;
  if (excluded.length > 0) normalized.excluded_x_handles = excluded;

  if (params.from_date) normalized.from_date = normalizeDate(params.from_date, "from_date");
  if (params.to_date) normalized.to_date = normalizeDate(params.to_date, "to_date");
  if (normalized.from_date && normalized.to_date && normalized.from_date > normalized.to_date) {
    throw new Error("xsearch from_date must be before or equal to to_date");
  }

  return normalized;
}

export function buildXSearchRequest(params: NormalizedXSearchParams, config: XSearchConfig): XSearchRequest {
  const tool: XSearchToolConfig = { type: "x_search" };
  if (params.allowed_x_handles?.length) tool.allowed_x_handles = params.allowed_x_handles;
  if (params.excluded_x_handles?.length) tool.excluded_x_handles = params.excluded_x_handles;
  if (params.from_date) tool.from_date = params.from_date;
  if (params.to_date) tool.to_date = params.to_date;
  if (config.enableImageUnderstanding) tool.enable_image_understanding = true;
  if (config.enableVideoUnderstanding) tool.enable_video_understanding = true;

  return {
    model: config.model,
    input: [{ role: "user", content: params.query }],
    tools: [tool],
  };
}

export function parseXaiResponse(response: unknown, query: string, model: string): XSearchDetails {
  if (!isObject(response)) throw new Error("Malformed xAI response: expected an object");

  const textParts: string[] = [];
  const citations = new Set<string>();

  if (Array.isArray(response.output)) {
    for (const item of response.output) {
      if (!isObject(item) || !Array.isArray(item.content)) continue;
      for (const content of item.content) {
        if (!isObject(content)) continue;
        if (typeof content.text === "string") textParts.push(content.text);
        if (Array.isArray(content.annotations)) {
          for (const annotation of content.annotations) {
            if (isObject(annotation) && typeof annotation.url === "string" && annotation.url.trim()) {
              citations.add(annotation.url);
            }
          }
        }
      }
    }
  }

  if (Array.isArray(response.citations)) {
    for (const citation of response.citations) {
      if (typeof citation === "string" && citation.trim()) citations.add(citation);
    }
  }

  const usage = isObject(response.usage) ? response.usage as XaiUsage : undefined;
  const toolUsage = usage?.server_side_tool_usage_details;
  const details: XSearchDetails = {
    query,
    model,
    text: textParts.join("\n\n").trim(),
    citations: [...citations],
  };

  const inputTokens = numberOrUndefined(usage?.input_tokens);
  const outputTokens = numberOrUndefined(usage?.output_tokens);
  const totalTokens = numberOrUndefined(usage?.total_tokens);
  const xSearchCalls = numberOrUndefined(toolUsage?.x_search_calls);
  const webSearchCalls = numberOrUndefined(toolUsage?.web_search_calls);
  // xAI bills per fetched item separately from calls, and `x_users_fetched` is
  // the only signal that account discovery actually ran, so both counts are
  // surfaced rather than dropped.
  const xPostsFetched = numberOrUndefined(toolUsage?.x_posts_fetched);
  const xUsersFetched = numberOrUndefined(toolUsage?.x_users_fetched);
  if (inputTokens !== undefined) details.inputTokens = inputTokens;
  if (outputTokens !== undefined) details.outputTokens = outputTokens;
  if (totalTokens !== undefined) details.totalTokens = totalTokens;
  if (xSearchCalls !== undefined) details.xSearchCalls = xSearchCalls;
  if (webSearchCalls !== undefined) details.webSearchCalls = webSearchCalls;
  if (xPostsFetched !== undefined) details.xPostsFetched = xPostsFetched;
  if (xUsersFetched !== undefined) details.xUsersFetched = xUsersFetched;

  return details;
}

export async function searchX(
  params: XSearchParams,
  config: XSearchConfig,
  apiKey: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<{ markdown: string; details: XSearchDetails }> {
  const normalized = normalizeParams(params);
  const request = buildXSearchRequest(normalized, config);

  const response = await fetcher(XAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(request),
    signal,
  });

  const bodyText = await response.text();
  let body: unknown;
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    if (!response.ok) throw new Error(`xAI X search failed with status ${response.status}: ${response.statusText}`);
    throw new Error("Malformed xAI response: response body is not valid JSON");
  }

  if (!response.ok) {
    throw new Error(`xAI X search failed with status ${response.status}: ${sanitizeErrorMessage(extractErrorMessage(body, response.statusText), apiKey)}`);
  }

  const details = parseXaiResponse(body, normalized.query, config.model);
  return { markdown: formatXSearchResults(details), details };
}

function normalizeHandles(handles: string[] | undefined, name: string): string[] {
  if (!handles?.length) return [];
  if (handles.length > 20) throw new Error(`xsearch ${name} supports max 20 handles`);
  const normalized = handles
    .map((handle) => handle.trim().replace(/^@+/, ""))
    .filter((handle) => handle.length > 0);
  if (normalized.length > 20) throw new Error(`xsearch ${name} supports max 20 handles`);
  return normalized;
}

function normalizeDate(date: string, name: string): string {
  const trimmed = date.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error(`xsearch ${name} must use YYYY-MM-DD format`);
  }
  return trimmed;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
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
