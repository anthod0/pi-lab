import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerXSearchTool } from "./tool.js";

/**
 * XSearch extension for pi coding agent.
 *
 * Registers the `xsearch` tool, which returns an answer plus citation URLs.
 * Backend is chosen by credentials: `XAI_API_KEY` uses xAI's native `x_search`;
 * otherwise `TWITTERAPI_IO_API_KEY` retrieves posts and `xsearch.synthesisModel`
 * synthesizes the answer.
 */
export default function (pi: ExtensionAPI) {
  registerXSearchTool(pi);
}

export { registerXSearchTool } from "./tool.js";
export {
  runTwitterApiSearch,
  runTwitterApiThread,
  runTwitterApiUserSearch,
  selectBackend,
  resolveModel,
  assistantText,
  toSynthesisModel,
  createFetchMedia,
} from "./backend.js";
export type { Backend, ModelLike, RegistryLike } from "./backend.js";
export { DEFAULT_MAX_MEDIA_PER_SEARCH, loadXSearchConfig } from "./config.js";
export type { XSearchBackend, XSearchConfig } from "./config.js";
export {
  DEFAULT_XSEARCH_MODEL,
  XAI_RESPONSES_URL,
  buildXSearchRequest,
  normalizeParams,
  parseXaiResponse,
  searchX,
} from "./xai.js";
export type {
  NormalizedXSearchParams,
  XSearchDetails,
  XSearchParams,
  XSearchRequest,
} from "./xai.js";
export {
  buildCandidatePrompt,
  collectMedia,
  deriveCitations,
  extractUrls,
  statusId,
  synthesizeAnswer,
  toBase64,
} from "./synthesize.js";
export type { ImageAttachment, SynthesisModel } from "./synthesize.js";
export {
  buildExpression,
  fetchThread,
  normalizeParams as normalizeTwitterApiParams,
  searchTweets,
  searchUsers,
  statusIdFromUrl,
  tweetIdFromInput,
} from "./twitterapi.js";
export type { SearchDetails, Tweet, TwitterApiSearchParams } from "./twitterapi.js";
