/**
 * Synthesis hop for the twitterapi.io backend.
 *
 * twitterapi.io returns raw posts; `@pi-lab/xsearch`'s contract is an answer plus
 * citation URLs. This module closes that gap: the retrieved posts are handed to a
 * configured model under a citation-constrained prompt, and citations are then
 * derived *from the candidate permalinks we actually fetched* — never from
 * whatever the model happens to type. A generated link that was not in the
 * candidate set is counted and disclosed instead of being published as a source.
 */
import type { XSearchDetails } from "./xai.js";
import type { XSearchConfig } from "./config.js";
import { statusIdFromUrl } from "./twitterapi.js";
import type { Tweet, UserProfile } from "./twitterapi.js";

export interface ImageAttachment {
  /** base64 payload, no data: prefix. */
  data: string;
  mimeType: string;
}

export interface SynthesisModel {
  provider: string;
  id: string;
  /** Whether the model advertises image input (`model.input` includes "image"). */
  supportsImage: boolean;
}

export interface SynthesisRequest {
  model: SynthesisModel;
  system: string;
  prompt: string;
  images: ImageAttachment[];
  /** Ordered description of `images`, so an attachment can be traced to its post. */
  mediaManifest?: string;
  signal?: AbortSignal;
}

export interface SynthesisDeps {
  /** Run one completion and return the assistant text. */
  complete(request: SynthesisRequest): Promise<string>;
  /**
   * Fetch a media URL as base64. Returns undefined when unavailable. The
   * optional timeout lets the caller cap the download at the remaining media
   * phase budget; it may only shorten the implementation's own deadline.
   */
  fetchMedia?(url: string, timeoutMs?: number): Promise<ImageAttachment | undefined>;
  /** Injected clock for the media budget, for tests. */
  now?: () => number;
  /** Media-phase time budget in ms (default 60_000), for tests. */
  mediaBudgetMs?: number;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Standard base64 over bytes; avoids depending on Buffer. */
export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const triplet = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    out += BASE64_ALPHABET[(triplet >> 18) & 63];
    out += BASE64_ALPHABET[(triplet >> 12) & 63];
    out += b1 === undefined ? "=" : BASE64_ALPHABET[(triplet >> 6) & 63];
    out += b2 === undefined ? "=" : BASE64_ALPHABET[triplet & 63];
  }
  return out;
}

export const SYNTHESIS_SYSTEM_PROMPT = [
  "You answer questions using ONLY the X (Twitter) posts provided in the user message.",
  "",
  "Rules:",
  "- Ground every claim in the provided posts. Do not add outside facts or speculation.",
  "- Cite inline using the post's EXACT permalink URL, in parentheses, right after the claim it supports.",
  "- Never invent, guess, or modify a permalink. Use only permalinks listed in the posts.",
  "- If the posts do not answer the question, say so plainly instead of filling the gap.",
  "- Be concise. Group related posts by theme rather than summarising one by one.",
].join("\n");

const MAX_TEXT_CHARS = 700;

function truncate(text: string, limit = MAX_TEXT_CHARS): string {
  const trimmed = text.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
}

/** Render the retrieved posts as the synthesis input. */
export function buildCandidatePrompt(query: string, tweets: Tweet[]): string {
  const lines = [`Question: ${query}`, "", `Posts (${tweets.length}):`, ""];
  tweets.forEach((tweet, index) => {
    const handle = tweet.author?.userName ? `@${tweet.author.userName}` : "@unknown";
    const when = tweet.createdAt ?? "unknown time";
    const metrics = [
      tweet.likeCount !== undefined ? `${tweet.likeCount} likes` : undefined,
      tweet.retweetCount !== undefined ? `${tweet.retweetCount} reposts` : undefined,
      tweet.viewCount !== undefined ? `${tweet.viewCount} views` : undefined,
    ]
      .filter(Boolean)
      .join(", ");
    lines.push(`[${index + 1}] ${handle} — ${when}${metrics ? ` — ${metrics}` : ""}`);
    lines.push(truncate(tweet.text ?? ""));
    if (tweet.url) lines.push(`permalink: ${tweet.url}`);
    if (tweet.media?.length) {
      const kinds = tweet.media.map((m) => m.type ?? "media").join(", ");
      lines.push(`media: ${kinds}`);
    }
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}

/**
 * Status id from a post permalink, used to match citations robustly.
 * Re-exported from `twitterapi.ts`, which owns X-URL parsing, so post and
 * profile matching cannot drift apart.
 */
export const statusId = statusIdFromUrl;

/** Account handle from a profile permalink, matched the same way as status ids. */
export function profileHandle(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (!isXHost(parsed.hostname)) return undefined;
  const match = /^\/([A-Za-z0-9_]{1,15})\/?$/.exec(parsed.pathname);
  return match?.[1]?.toLowerCase();
}

/** True only for x.com / twitter.com hosts (with optional www./mobile prefixes). */
function isXHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com");
}

function normalizeUrl(url: string): string {
  return url
    .trim()
    .replace(/[.,;:)\]]+$/, "")
    .replace(/^https?:\/\//i, "")
    .replace(/^(www\.)?(twitter|x)\.com/i, "x.com")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/**
 * All URLs appearing in generated text, with sentence punctuation trimmed.
 * Prose commonly glues `.`, `,` or a closing bracket to the end of a link.
 */
export function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"'\]]+/gi) ?? [];
  return matches.map(trimTrailingPunctuation).filter((url) => url.length > 0);
}

function trimTrailingPunctuation(raw: string): string {
  let url = raw.trim().replace(/[.,;:!?]+$/, "");
  // Only drop a closing bracket when it does not pair with an opening one
  // (a balanced `)` can legitimately end a URL).
  while (url.endsWith(")") && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
    url = url.slice(0, -1);
  }
  return url;
}

export interface CitationResult {
  citations: string[];
  /** Links in the answer that were NOT among the fetched posts. */
  fabricated: string[];
}

/**
 * Keep only citations that correspond to a fetched post, in order of first use.
 */
export function deriveCitations(answerText: string, candidates: Tweet[]): CitationResult {
  const byStatusId = new Map<string, string>();
  const byUrl = new Map<string, string>();
  for (const tweet of candidates) {
    if (!tweet.url) continue;
    const id = statusId(tweet.url);
    if (id) byStatusId.set(id, tweet.url);
    byUrl.set(normalizeUrl(tweet.url), tweet.url);
  }

  const citations: string[] = [];
  const fabricated: string[] = [];
  const seen = new Set<string>();

  for (const raw of extractUrls(answerText)) {
    const id = statusId(raw);
    const canonical = (id ? byStatusId.get(id) : undefined) ?? byUrl.get(normalizeUrl(raw));
    if (canonical) {
      if (!seen.has(canonical)) {
        seen.add(canonical);
        citations.push(canonical);
      }
      continue;
    }
    const normalized = normalizeUrl(raw);
    if (/x\.com\//.test(normalized) && !seen.has(normalized)) {
      seen.add(normalized);
      fabricated.push(raw.trim());
    }
  }

  return { citations, fabricated };
}

function extensionMime(url: string): string {
  const path = url.split("?")[0].toLowerCase();
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

export interface MediaCollection {
  images: ImageAttachment[];
  /** Post permalink + media kind per accepted image, aligned with `images`. */
  labels: string[];
  notes: string[];
  /** Posts with media that were considered (before any cap). */
  available: number;
}

const MEDIA_PHASE_BUDGET_MS = 60_000;

/**
 * Collect media attachments for synthesis.
 *
 * Images are attached directly. Video cannot be sent to a chat model, so the
 * post's poster frame is attached instead and the limitation is disclosed —
 * that is the honest ceiling of "video understanding" on this backend.
 */
export async function collectMedia(
  tweets: Tweet[],
  config: XSearchConfig,
  model: SynthesisModel,
  deps: SynthesisDeps,
): Promise<MediaCollection> {
  const notes: string[] = [];
  const images: ImageAttachment[] = [];
  const labels: string[] = [];
  const wanted = config.enableImageUnderstanding || config.enableVideoUnderstanding;
  const withMedia = tweets.filter((t) => (t.media?.length ?? 0) > 0);
  if (!wanted || withMedia.length === 0) return { images, labels, notes, available: withMedia.length };

  if (!model.supportsImage) {
    notes.push(
      `Media understanding was requested but ${model.provider}/${model.id} does not accept image input, ` +
        `so ${withMedia.length} post(s) with media were analysed from text only.`,
    );
    return { images, labels, notes, available: withMedia.length };
  }

  const fetchMedia = deps.fetchMedia;
  if (!fetchMedia) return { images, labels, notes, available: withMedia.length };

  // Bound the *attempts*, not just the accepted attachments: `images` only grows
  // on success, so a topic full of dead media URLs could otherwise attempt one
  // download per media item, each up to its own 20s deadline.
  const attemptCap = Math.max(1, config.maxMediaPerSearch) * 3;
  const budgetMs = deps.mediaBudgetMs ?? MEDIA_PHASE_BUDGET_MS;
  const clock = deps.now ?? Date.now;
  const deadline = clock() + budgetMs;
  let attempts = 0;
  let skippedForCap = 0;
  let skippedForBudget = 0;
  let failed = 0;
  let videoPosters = 0;

  for (const tweet of withMedia) {
    for (const media of tweet.media ?? []) {
      const isVideo = media.type === "video" || media.type === "animated_gif";
      if (isVideo && !config.enableVideoUnderstanding) continue;
      if (!isVideo && !config.enableImageUnderstanding) continue;
      if (!media.url) continue;
      if (images.length >= config.maxMediaPerSearch) {
        skippedForCap += 1;
        continue;
      }
      if (attempts >= attemptCap || clock() >= deadline) {
        skippedForBudget += 1;
        continue;
      }
      attempts += 1;
      // Cap this download at whatever remains of the phase budget: checking the
      // deadline only before starting would let a slow transfer begin at 59s and
      // run past the disclosed 60s bound.
      const attachment = await fetchMedia(media.url, Math.max(1, deadline - clock()));
      if (!attachment) {
        failed += 1;
        continue;
      }
      images.push({ data: attachment.data, mimeType: attachment.mimeType || extensionMime(media.url) });
      labels.push(`${tweet.url ?? "(post without a permalink)"} — ${media.type ?? "media"}`);
      if (isVideo) videoPosters += 1;
    }
  }

  if (videoPosters > 0) {
    notes.push(
      `${videoPosters} video post(s) were represented by their poster frame only — chat models cannot ingest video, ` +
        "so the spoken/visual content inside those videos was not analysed.",
    );
  }
  if (skippedForCap > 0) {
    notes.push(`${skippedForCap} media item(s) skipped: per-search media cap is ${config.maxMediaPerSearch}.`);
  }
  if (skippedForBudget > 0) {
    notes.push(
      `${skippedForBudget} media item(s) were not attempted: downloads are bounded to ${attemptCap} attempts and ` +
        `${Math.round(budgetMs / 1_000)}s per search so one media-heavy topic cannot stall the call.`,
    );
  }
  if (failed > 0) notes.push(`${failed} media item(s) could not be downloaded and were skipped.`);

  return { images, labels, notes, available: withMedia.length };
}

export interface SynthesizeOptions {
  query: string;
  tweets: Tweet[];
  config: XSearchConfig;
  model: SynthesisModel;
  deps: SynthesisDeps;
  signal?: AbortSignal;
  /**
   * Why retrieval stopped before exhausting the upstream, when it did. Prevents
   * an empty result from being reported as "nothing matched".
   */
  incomplete?: string;
}

/** Run the synthesis hop and return contract-shaped details. */
export async function synthesizeAnswer(options: SynthesizeOptions): Promise<XSearchDetails> {
  const { query, tweets, config, model, deps, signal, incomplete } = options;
  if (tweets.length === 0) {
    return {
      query,
      model: `${model.provider}/${model.id}`,
      text: incomplete
        ? `No posts matched this query, but retrieval stopped early (${incomplete}), so more posts may exist.`
        : "No posts matched this query, so there is nothing to summarise.",
      citations: [],
      xSearchCalls: 0,
      notes: [
        incomplete
          ? `Zero posts were returned, and retrieval stopped early (${incomplete}).`
          : "Zero posts were returned by the search for this window and query.",
      ],
    };
  }

  const media = await collectMedia(tweets, config, model, deps);
  const text = await deps.complete({
    model,
    system: SYNTHESIS_SYSTEM_PROMPT,
    prompt: buildCandidatePrompt(query, tweets),
    images: media.images,
    // Without this, flattened attachments lose their provenance: the model sees
    // images with no way to tell which post each came from, and downloads that
    // failed shift the positions of the rest.
    mediaManifest:
      media.labels.length > 0 ? media.labels.map((label, index) => `${index + 1}. ${label}`).join("\n") : undefined,
    signal,
  });

  const { citations: citedInline, fabricated } = deriveCitations(text, tweets);
  const notes = [...media.notes];
  // Contract parity with the xAI backend: xAI lists the sources its search
  // surfaced, so when the model cites nothing inline we list the retrieved
  // posts rather than emitting an empty Sources section. Only permalinks we
  // actually fetched are ever listed — the fallback cannot invent anything.
  const citations =
    citedInline.length > 0
      ? citedInline
      : tweets.map((tweet) => tweet.url).filter((url): url is string => Boolean(url));

  if (citedInline.length === 0 && citations.length > 0) {
    notes.push(
      `The answer cited no permalinks inline; Sources lists the ${citations.length} post(s) retrieved for this query.`,
    );
  }
  if (fabricated.length > 0) {
    notes.push(
      `${fabricated.length} link(s) in the answer did not match any retrieved post and were dropped from Sources.`,
    );
  }

  return {
    query,
    model: `${model.provider}/${model.id}`,
    text,
    citations,
    xSearchCalls: 1,
    notes: notes.length > 0 ? notes : undefined,
  };
}

// ------------------------------------------------------------------- accounts

export const USER_SYNTHESIS_SYSTEM_PROMPT = [
  "You answer questions using ONLY the X (Twitter) accounts provided in the user message.",
  "",
  "Rules:",
  "- Ground every claim in the provided accounts. Do not add outside facts or speculation.",
  "- Cite inline using the account's EXACT profile URL, in parentheses, right after the claim it supports.",
  "- Never invent, guess, or modify a profile URL. Use only the URLs listed in the accounts.",
  "- Group or rank accounts by relevance when that helps; mention follower counts only when they matter.",
  "- If the accounts do not answer the question, say so plainly instead of filling the gap.",
  "- Be concise.",
].join("\n");

export function buildUserCandidatePrompt(query: string, users: UserProfile[]): string {
  const lines = [`Question: ${query}`, "", `Accounts (${users.length}):`, ""];
  users.forEach((user, index) => {
    const metrics: string[] = [];
    if (typeof user.followers === "number") metrics.push(`${user.followers} followers`);
    if (user.verified) metrics.push("verified");
    lines.push(
      `[${index + 1}] @${user.handle}${user.name ? ` — ${user.name}` : ""}${metrics.length ? ` — ${metrics.join(", ")}` : ""}`,
    );
    if (user.bio) lines.push(truncate(user.bio));
    lines.push(`profile: ${user.profileUrl}`);
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}

/**
 * Keep only citations that correspond to a fetched account, in order of first
 * use. Matching is by handle on validated X hosts, so a look-alike profile URL
 * on another domain is never published as a source.
 */
export function deriveUserCitations(answerText: string, candidates: UserProfile[]): CitationResult {
  const byHandle = new Map<string, string>();
  const byUrl = new Map<string, string>();
  for (const user of candidates) {
    byHandle.set(user.handle.toLowerCase(), user.profileUrl);
    byUrl.set(normalizeUrl(user.profileUrl), user.profileUrl);
  }

  const citations: string[] = [];
  const fabricated: string[] = [];
  const seen = new Set<string>();

  for (const raw of extractUrls(answerText)) {
    const handle = profileHandle(raw);
    const canonical = (handle ? byHandle.get(handle) : undefined) ?? byUrl.get(normalizeUrl(raw));
    if (canonical) {
      if (!seen.has(canonical)) {
        seen.add(canonical);
        citations.push(canonical);
      }
      continue;
    }
    const normalized = normalizeUrl(raw);
    if (/x\.com\//.test(normalized) && !seen.has(normalized)) {
      seen.add(normalized);
      fabricated.push(raw.trim());
    }
  }

  return { citations, fabricated };
}

export interface SynthesizeUserOptions {
  query: string;
  users: UserProfile[];
  config: XSearchConfig;
  model: SynthesisModel;
  deps: SynthesisDeps;
  signal?: AbortSignal;
  /** Why retrieval stopped early, when it did. */
  incomplete?: string;
}

/** Synthesis hop for an account search; mirrors `synthesizeAnswer`'s contract. */
export async function synthesizeUserAnswer(options: SynthesizeUserOptions): Promise<XSearchDetails> {
  const { query, users, model, deps, signal, incomplete } = options;
  if (users.length === 0) {
    return {
      query,
      model: `${model.provider}/${model.id}`,
      text: incomplete
        ? `No accounts matched this query, but retrieval stopped early (${incomplete}), so more may exist.`
        : "No accounts matched this query, so there is nothing to summarise.",
      citations: [],
      xSearchCalls: 0,
      notes: [
        incomplete
          ? `Zero accounts were returned, and retrieval stopped early (${incomplete}).`
          : "Zero accounts were returned by the search.",
      ],
    };
  }

  const text = await deps.complete({
    model,
    system: USER_SYNTHESIS_SYSTEM_PROMPT,
    prompt: buildUserCandidatePrompt(query, users),
    // Account search attaches no post media: the candidates are profiles.
    images: [],
    signal,
  });

  const { citations: citedInline, fabricated } = deriveUserCitations(text, users);
  const notes: string[] = [];
  // Contract parity with the post path: when nothing is cited inline, Sources
  // lists what was actually retrieved rather than going empty.
  const citations = citedInline.length > 0 ? citedInline : users.map((user) => user.profileUrl);
  if (citedInline.length === 0 && citations.length > 0) {
    notes.push(`The answer cited no profile URLs inline; Sources lists the ${citations.length} account(s) retrieved for this query.`);
  }
  if (fabricated.length > 0) {
    notes.push(`${fabricated.length} link(s) in the answer did not match any retrieved account and were dropped from Sources.`);
  }

  return {
    query,
    model: `${model.provider}/${model.id}`,
    text,
    citations,
    xSearchCalls: 1,
    notes: notes.length > 0 ? notes : undefined,
  };
}
