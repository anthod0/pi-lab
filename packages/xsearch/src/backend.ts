import type { XSearchConfig, XSearchBackend } from "./config.js";
import { formatXSearchResults } from "./format.js";
import type { XSearchDetails } from "./xai.js";
import { toBase64, synthesizeAnswer, synthesizeUserAnswer, type ImageAttachment, type SynthesisModel, type SynthesisRequest } from "./synthesize.js";
import {
  fetchThread,
  normalizeParams,
  searchTweets,
  searchUsers,
  type TwitterApiSearchParams,
} from "./twitterapi.js";

export type Backend = Exclude<XSearchBackend, "auto">;

/**
 * Minimal structural view of pi's ModelRegistry, so this module stays testable
 * without importing pi internals.
 *
 * Only `find` and `getAll` are required: they exist across the supported pi
 * range. `complete` does NOT — pi 0.80.6 has no such member (verified in both
 * its .d.ts and compiled JS), so it is optional here and feature-detected at
 * call time rather than assumed. Keeping it optional is what lets the real
 * ModelRegistry be passed without a cast, so a future signature change fails
 * typecheck instead of silently breaking at runtime.
 */
export interface RegistryLike {
  find(provider: string, modelId: string): ModelLike | undefined;
  getAll(): readonly ModelLike[];
  complete?(model: never, context: never, options?: never): Promise<unknown>;
}

export interface ModelLike {
  provider: string;
  id: string;
  input?: readonly string[];
}
export interface BackendOptions {
  env?: Record<string, string | undefined>;
  fetcher?: typeof fetch;
  registry?: RegistryLike;
  signal?: AbortSignal;
}

/**
 * Choose the backend from available credentials.
 *
 * `auto` prefers xAI when `XAI_API_KEY` is present, otherwise twitterapi.io.
 * An explicit `backend` setting pins one; it returns undefined when the pinned
 * backend has no credentials.
 */
export function selectBackend(config: XSearchConfig, env: Record<string, string | undefined>): Backend | undefined {
  const hasXai = Boolean(env.XAI_API_KEY);
  const hasTwitterApi = Boolean(env.TWITTERAPI_IO_API_KEY);
  if (config.backend === "xai") return hasXai ? "xai" : undefined;
  if (config.backend === "twitterapi") return hasTwitterApi ? "twitterapi" : undefined;
  if (hasXai) return "xai";
  if (hasTwitterApi) return "twitterapi";
  return undefined;
}

/** Resolve a `provider/model` spec, or a bare model id, against the registry. */
export function resolveModel(registry: RegistryLike, spec: string): ModelLike | undefined {
  const known = registry.getAll();
  const slash = spec.indexOf("/");
  const provider = slash > 0 ? spec.slice(0, slash) : undefined;
  const id = slash > 0 ? spec.slice(slash + 1) : spec;
  const scope = known.filter((model) => provider === undefined || model.provider === provider);
  const describe = (models: ModelLike[]): string => models.map((model) => `${model.provider}/${model.id}`).join(", ");

  const exact = scope.filter((model) => model.id === id);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new Error(
      `xsearch model "${spec}" is ambiguous across providers (${exact.map((model) => model.provider).join(", ")}); ` +
        'configure it as "provider/model" in the xsearch settings block.',
    );
  }

  // A provider may namespace its own ids, so a model the catalogue calls
  // `<vendor>/<model>` is accepted by pi's `--model` as `provider/<model>`. An id
  // matching one namespaced model is therefore a valid short form, not a typo.
  const suffixed = scope.filter((model) => model.id.endsWith(`/${id}`));
  if (suffixed.length === 1) return suffixed[0];
  if (suffixed.length > 1) {
    throw new Error(
      `xsearch model "${spec}" matches several models (${describe(suffixed)}); write the full model id.`,
    );
  }
  return undefined;
}

/** Model ids a provider exposes, so a "not found" error can be acted on. */
function availableModels(known: readonly ModelLike[], provider: string | undefined): string {
  const ids = known
    .filter((model) => provider === undefined || model.provider === provider)
    .map((model) => `${model.provider}/${model.id}`)
    .sort();
  const shown = ids.slice(0, 8);
  return ids.length > shown.length ? `${shown.join(", ")}, and ${ids.length - shown.length} more` : shown.join(", ");
}

export function toSynthesisModel(model: ModelLike): SynthesisModel {
  return { provider: model.provider, id: model.id, supportsImage: (model.input ?? []).includes("image") };
}

/** Concatenate the text blocks of an assistant message. */
export function assistantText(message: unknown): string {
  if (typeof message !== "object" || message === null) return "";
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      typeof block === "object" && block !== null && (block as { type?: string }).type === "text"
        ? String((block as { text?: unknown }).text ?? "")
        : "",
    )
    .filter(Boolean)
    .join("\n")
    .trim();
}

const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const MEDIA_TIMEOUT_MS = 20_000;

/**
 * Validate a completion result before its text is treated as an answer.
 *
 * `ModelRegistry.complete` resolves with the assistant message even when the
 * provider reported a failure, so an unchecked result turns an error into an
 * empty-but-successful answer. Anything other than a normal stop must fail here
 * rather than reach the user as a blank answer with real sources attached.
 */
export function completionText(message: unknown): string {
  const record = typeof message === "object" && message !== null ? (message as Record<string, unknown>) : {};
  const stopReason = typeof record.stopReason === "string" ? record.stopReason : undefined;
  const detail = typeof record.errorMessage === "string" && record.errorMessage ? `: ${record.errorMessage}` : "";
  if (stopReason === "error") throw new Error(`xsearch synthesis failed${detail}`);
  if (stopReason === "aborted") throw new Error("xsearch synthesis was cancelled before it produced an answer");
  if (stopReason === "toolUse") throw new Error("xsearch synthesis tried to call a tool instead of answering");
  const text = assistantText(message);
  if (!text) {
    throw new Error(
      stopReason === "length"
        ? "xsearch synthesis hit the model's output limit before producing any text"
        : "xsearch synthesis returned an empty answer",
    );
  }
  return text;
}

/** Read a body while enforcing a byte cap, so an oversized response is never fully buffered. */
async function readCapped(response: Response, limit: number): Promise<Uint8Array | undefined> {
  const body = response.body;
  if (!body) return undefined;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export interface FetchMediaLimits {
  /** Maximum accepted image size in bytes (default 8 MiB). */
  maxBytes?: number;
  /** Per-download deadline covering the body read (default 20s). */
  timeoutMs?: number;
}

export function createFetchMedia(fetcher: typeof fetch, callerSignal?: AbortSignal, limits: FetchMediaLimits = {}) {
  const maxBytes = limits.maxBytes ?? MAX_MEDIA_BYTES;
  const timeoutMs = limits.timeoutMs ?? MEDIA_TIMEOUT_MS;
  return async function fetchMedia(url: string, timeoutMsOverride?: number): Promise<ImageAttachment | undefined> {
    const budget = timeoutMsOverride === undefined ? timeoutMs : Math.max(1, Math.min(timeoutMsOverride, timeoutMs));
    if (callerSignal?.aborted) return undefined;
    // A stalled image must not outlive the tool call: the download carries the
    // caller's signal and its own deadline, covering the body read too. A caller
    // may shorten that deadline (the media phase passes what remains of its
    // budget) but never extend it.
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    callerSignal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), budget);
    try {
      const response = await fetcher(url, { signal: controller.signal });
      if (!response.ok) return undefined;
      const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
      if (!mimeType.startsWith("image/")) return undefined;
      const declared = Number(response.headers.get("content-length") ?? Number.NaN);
      if (Number.isFinite(declared) && declared > maxBytes) return undefined;
      const bytes = await readCapped(response, maxBytes);
      if (!bytes) return undefined;
      return { data: toBase64(bytes), mimeType };
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onAbort);
    }
  };
}

/**
 * Build the synthesis completion for a resolved model. Shared by every
 * twitterapi.io path so failure handling cannot differ between them.
 */
function createCompletion(
  registry: RegistryLike,
  run: NonNullable<RegistryLike["complete"]>,
  model: ModelLike,
): (request: SynthesisRequest) => Promise<string> {
  return async (request) => {
    const promptText =
      request.mediaManifest && request.images.length > 0
        ? `${request.prompt}\n\nAttached images, in order:\n${request.mediaManifest}`
        : request.prompt;
    const message = await run.call(
      registry,
      model as never,
      {
        systemPrompt: request.system,
        messages: [
          {
            role: "user",
            content:
              request.images.length > 0
                ? [
                    { type: "text", text: promptText },
                    ...request.images.map((image) => ({
                      type: "image",
                      data: image.data,
                      mimeType: image.mimeType,
                    })),
                  ]
                : request.prompt,
            timestamp: Date.now(),
          },
        ],
      } as never,
      { signal: request.signal } as never,
    );
    return completionText(message);
  };
}

interface SynthesisBackend {
  fetcher: typeof fetch;
  apiKey: string;
  model: ModelLike;
  /** Ready-to-use synthesis completion, with failure handling already applied. */
  complete: (request: SynthesisRequest) => Promise<string>;
}

/**
 * Shared preflight: credentials, the synthesis model, and its completion. Runs
 * before any network work so a misconfiguration fails immediately and says why.
 */
function resolveSynthesisBackend(options: TwitterApiSynthesisOptions): SynthesisBackend {
  const fetcher = options.fetcher ?? fetch;
  const apiKey = options.env?.TWITTERAPI_IO_API_KEY;
  if (!apiKey) {
    throw new Error("TWITTERAPI_IO_API_KEY must be configured to use the twitterapi.io backend.");
  }
  const registry = options.registry;
  if (!registry) {
    throw new Error("xsearch could not reach pi's model registry, which the twitterapi.io backend needs for synthesis.");
  }

  // `complete` is not present on every supported pi version, so it is detected
  // here instead of being assumed (verified absent on pi 0.80.6, present on 0.99.2).
  const run = registry.complete;
  if (typeof run !== "function") {
    throw new Error(
      "the twitterapi.io backend needs pi's ModelRegistry.complete, which this pi version does not provide " +
        "(verified absent on pi 0.80.6, present on 0.99.2). Upgrade pi, or set XAI_API_KEY to use the xAI backend instead.",
    );
  }

  const synthesisModelId = options.config.synthesisModel;
  if (!synthesisModelId) {
    throw new Error(
      "the twitterapi.io backend needs a synthesis model: set xsearch.synthesisModel to a model id from pi's " +
        "catalogue. xsearch.model is reserved for the xAI backend.",
    );
  }
  const model = resolveModel(registry, synthesisModelId);
  if (!model) {
    const slash = synthesisModelId.indexOf("/");
    const provider = slash > 0 ? synthesisModelId.slice(0, slash) : undefined;
    const available = availableModels(registry.getAll(), provider);
    throw new Error(
      `xsearch synthesis model "${synthesisModelId}" was not found in pi's model catalogue. ` +
        (available ? `Known models${provider ? ` for "${provider}"` : ""}: ${available}. ` : "") +
        "Set xsearch.synthesisModel to a model id from pi's catalogue.",
    );
  }
  return { fetcher, apiKey, model, complete: createCompletion(registry, run, model) };
}

/** Options shared by every twitterapi.io run path. */
export interface TwitterApiSynthesisOptions extends BackendOptions {
  config: XSearchConfig;
  /**
   * Fixed local UTC offset in minutes. Omit to use the host timezone. Exposed so
   * the trim-band behaviour can be tested deterministically.
   */
  localUtcOffsetMinutes?: number;
}

export interface TwitterApiRunOptions extends TwitterApiSynthesisOptions {
  params: TwitterApiSearchParams;
}

export interface TwitterApiUserSearchOptions extends TwitterApiSynthesisOptions {
  /** Keyword to match against account names, handles and bios. */
  query: string;
  /** Max accounts to collect (default 20, max 50). */
  count?: number;
  /** Max pages to fetch (default 3). */
  maxPages?: number;
}

export interface TwitterApiThreadOptions extends TwitterApiSynthesisOptions {
  /** A post id or an X permalink of any post in the thread. */
  tweet: string;
  /**
   * The user's actual question about the thread. Kept separate from `tweet`
   * because the reference only locates the thread — using it as the synthesis
   * question would leave the model unable to answer what was asked.
   */
  query: string;
  /** Max pages of thread context (default: `config.maxPages`). */
  maxPages?: number;
}

/**
 * Resolve a page budget: an explicit value is validated first, then clamped to
 * the configured ceiling. Clamping before validating would turn `Infinity` or
 * `20.5` into a valid `20` and hide the caller's mistake.
 */
function pageBudget(explicit: number | undefined, config: XSearchConfig): number {
  if (explicit !== undefined && (!Number.isInteger(explicit) || explicit < 1)) {
    throw new Error(`xsearch maxPages must be a positive integer (got ${String(explicit)})`);
  }
  return Math.min(explicit ?? config.maxPages, config.maxPagesCeiling);
}

/** Why retrieval stopped short of exhausting the upstream, or undefined. */
function incompleteReason(stoppedBy: string | undefined, pages: number): string | undefined {
  if (stoppedBy === "cursor-cycle") return "the upstream cursor began repeating";
  if (stoppedBy === "cursor-missing") return "the upstream reported more results without a cursor to fetch them";
  if (stoppedBy === "page-cap") return `the ${pages}-page fetch limit was reached`;
  return undefined;
}

/**
 * Retrieve posts from twitterapi.io and synthesize the answer, returning the
 * same `{ markdown, details }` shape as the xAI backend.
 */
export async function runTwitterApiSearch(
  options: TwitterApiRunOptions,
): Promise<{ markdown: string; details: XSearchDetails }> {
  const { fetcher, apiKey, model, complete } = resolveSynthesisBackend(options);

  const params = normalizeParams(options.params);
  const search = await searchTweets(params, apiKey, fetcher, {
    signal: options.signal,
    minRequestIntervalMs: options.config.minRequestIntervalMs,
    retryBaseDelayMs: options.config.retryBaseDelayMs,
    maxPages: options.config.maxPages,
    maxPagesCeiling: options.config.maxPagesCeiling,
    localUtcOffsetMinutes: options.localUtcOffsetMinutes,
  });

  // Retrieval that stopped short of the upstream's last page is incomplete, and
  // must not be presented as an exhaustive answer to the query.
  const incomplete = incompleteReason(search.stoppedBy, search.pagesFetched ?? 0);

  const details = await synthesizeAnswer({
    query: params.query,
    tweets: search.tweets,
    config: options.config,
    model: toSynthesisModel(model),
    signal: options.signal,
    incomplete,
    deps: {
      complete,
      fetchMedia: createFetchMedia(fetcher, options.signal),
    },
  });

  if (search.window?.shortfallHours) {
    details.notes = [
      ...(details.notes ?? []),
      `Date window coverage: the upstream search stops ${search.window.shortfallHours}h before the end of the requested local window.`,
    ];
  }
  if (incomplete) {
    details.notes = [
      ...(details.notes ?? []),
      `Retrieval stopped early (${incomplete}) while the upstream still had more posts, so these results may be incomplete.`,
    ];
  }
  // Explain pages that bought nothing: east of UTC-4 the upstream day boundary
  // sits past local midnight, so the newest posts of the scan are always outside
  // the requested day and must be paged past before the real results begin.
  if (search.trimmedNewer) {
    const band = search.window?.trimHours;
    details.notes = [
      ...(details.notes ?? []),
      `${search.trimmedNewer} newer post(s) outside the requested local window were skipped while paging to it` +
        (band ? ` (twitterapi.io resolves date bounds at 04:00 UTC, ${band}h past local midnight at this offset)` : "") +
        ".",
    ];
  }
  if (search.trimmedOlder) {
    details.notes = [
      ...(details.notes ?? []),
      `${search.trimmedOlder} older post(s) before the requested local window were skipped ` +
        "(the upstream window is padded back a day so the local day's start is covered).",
    ];
  }

  return { markdown: formatXSearchResults(details), details };
}

/**
 * Search X accounts by keyword and summarize them — the counterpart of xAI's
 * `x_user_search`. Same contract, with profile URLs as the sources.
 */
export async function runTwitterApiUserSearch(
  options: TwitterApiUserSearchOptions,
): Promise<{ markdown: string; details: XSearchDetails }> {
  const { fetcher, apiKey, model, complete } = resolveSynthesisBackend(options);

  const search = await searchUsers(options.query, apiKey, fetcher, {
    signal: options.signal,
    count: options.count,
    // Configured budgets apply here too: the ceiling is a hard cap, and the base
    // budget is the configured one rather than this endpoint's own default.
    maxPages: pageBudget(options.maxPages, options.config),
    minRequestIntervalMs: options.config.minRequestIntervalMs,
    retryBaseDelayMs: options.config.retryBaseDelayMs,
  });

  const incomplete = incompleteReason(search.stoppedBy, search.pagesFetched);
  const details = await synthesizeUserAnswer({
    query: search.query,
    users: search.users,
    config: options.config,
    model: toSynthesisModel(model),
    signal: options.signal,
    incomplete,
    deps: { complete },
  });
  if (incomplete) {
    details.notes = [
      ...(details.notes ?? []),
      `Retrieval stopped early (${incomplete}) while the upstream still had more accounts, so this list may be incomplete.`,
    ];
  }
  // Measured: the endpoint matches a sub-string with no word boundaries, and a
  // multi-word query can return nothing at all ("pi coding agent" returned zero
  // accounts while "coding" returned twenty). Say so instead of leaving an empty
  // answer unexplained.
  if (search.users.length === 0 && search.query.trim().split(/\s+/).length > 1) {
    details.notes = [
      ...(details.notes ?? []),
      "twitterapi.io matches account search against a sub-string of names, handles and bios with no word boundaries, " +
        'and a multi-word query can match nothing; retry with a single distinctive keyword (for example "coding").',
    ];
  }
  return { markdown: formatXSearchResults(details), details };
}

/**
 * Fetch a post's thread context and answer from it — the counterpart of xAI's
 * `x_thread_fetch`.
 */
export async function runTwitterApiThread(
  options: TwitterApiThreadOptions,
): Promise<{ markdown: string; details: XSearchDetails }> {
  const { fetcher, apiKey, model, complete } = resolveSynthesisBackend(options);
  // Validated before the request, like the post and account paths: a blank
  // question would otherwise still pay for retrieval and synthesis.
  const question = options.query?.trim();
  if (!question) throw new Error("xsearch query must not be empty");

  const thread = await fetchThread(options.tweet, apiKey, fetcher, {
    signal: options.signal,
    maxPages: pageBudget(options.maxPages, options.config),
    minRequestIntervalMs: options.config.minRequestIntervalMs,
    retryBaseDelayMs: options.config.retryBaseDelayMs,
  });

  const incomplete = incompleteReason(thread.stoppedBy, thread.pagesFetched);
  const details = await synthesizeAnswer({
    // The question, not the reference: the reference only located the thread.
    query: question,
    tweets: thread.tweets,
    config: options.config,
    model: toSynthesisModel(model),
    signal: options.signal,
    incomplete,
    deps: { complete, fetchMedia: createFetchMedia(fetcher, options.signal) },
  });
  details.notes = [
    ...(details.notes ?? []),
    `Answered from the thread context of post ${thread.tweetId} (${thread.tweets.length} post(s), ${thread.pagesFetched} page(s)).`,
  ];
  if (incomplete) {
    details.notes = [
      ...(details.notes ?? []),
      `Retrieval stopped early (${incomplete}) while the thread continued, so these results may be incomplete.`,
    ];
  }
  return { markdown: formatXSearchResults(details), details };
}
