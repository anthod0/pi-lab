import { mergePiSettings, readPiProjectSettings, readPiUserSettings, type PiSettings } from "@pi-lab/utils";
import type { WebSearchProvider } from "./search.js";

export interface ReadWebSearchProviderOptions {
  cwd: string;
  projectTrusted: boolean;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

export function readWebSearchProvider(options: ReadWebSearchProviderOptions): WebSearchProvider {
  const settings = mergePiSettings(
    readPiUserSettings(options.home),
    options.projectTrusted ? readPiProjectSettings(options.cwd) : {},
  );
  return resolveWebSearchProvider(options.env ?? process.env, settings);
}

export function resolveWebSearchProvider(
  env: NodeJS.ProcessEnv,
  settings: PiSettings = {},
): WebSearchProvider {
  const environmentProvider = parseProvider(env.WEBSEARCH_PROVIDER, "WEBSEARCH_PROVIDER");
  if (environmentProvider) return environmentProvider;

  const configuredProvider = readSettingsProvider(settings);
  if (configuredProvider) return configuredProvider;

  if (env.PARALLEL_API_KEY) return "parallel";
  if (env.TINYFISH_API_KEY) return "tinyfish";
  if (env.EXA_API_KEY) return "exa";
  throw new Error("No websearch provider API key is configured. Set PARALLEL_API_KEY, TINYFISH_API_KEY, or EXA_API_KEY.");
}

function readSettingsProvider(settings: PiSettings): WebSearchProvider | undefined {
  const websearch = settings.websearch;
  if (websearch === undefined) return undefined;
  if (!isObject(websearch)) throw new Error("websearch must be an object in Pi settings.");
  return parseProvider(websearch.provider, "websearch.provider");
}

function parseProvider(value: unknown, name: string): WebSearchProvider | undefined {
  if (value === undefined) return undefined;
  if (value === "exa" || value === "parallel" || value === "tinyfish") return value;
  throw new Error(`${name} must be \"exa\", \"parallel\", or \"tinyfish\".`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
