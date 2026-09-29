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

  if (env.PARALLEL_API_KEY && !env.EXA_API_KEY) return "parallel";
  return "exa";
}

function readSettingsProvider(settings: PiSettings): WebSearchProvider | undefined {
  const websearch = settings.websearch;
  if (websearch === undefined) return undefined;
  if (!isObject(websearch)) throw new Error("websearch must be an object in Pi settings.");
  return parseProvider(websearch.provider, "websearch.provider");
}

function parseProvider(value: unknown, name: string): WebSearchProvider | undefined {
  if (value === undefined) return undefined;
  if (value === "exa" || value === "parallel") return value;
  throw new Error(`${name} must be either \"exa\" or \"parallel\".`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
