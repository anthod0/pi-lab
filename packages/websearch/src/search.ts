export type WebSearchProvider = "exa" | "parallel";
export type WebSearchType = "fast" | "balanced" | "deep";

export interface WebSearchParams {
  query: string;
  num_results?: number;
  type?: WebSearchType;
  include_domains?: string[];
  exclude_domains?: string[];
  start_published_date?: string;
  fresh?: boolean;
}

export interface NormalizedWebSearchParams extends WebSearchParams {
  query: string;
  num_results: number;
  type: WebSearchType;
  fresh: boolean;
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
  provider: WebSearchProvider;
  query: string;
  type: WebSearchType;
  resultCount: number;
  results: NormalizedSearchResult[];
  raw?: Record<string, unknown>;
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
    type: params.type ?? "balanced",
    fresh: params.fresh ?? false,
  };
}
