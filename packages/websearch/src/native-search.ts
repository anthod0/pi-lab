import { readPiProjectSettings, readPiUserSettings } from "@pi-lab/utils";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

// Deliberately independent of @pi-lab/openai so either extension can be installed alone.
// Keep native-search eligibility aligned with that extension.
export interface OpenAIConfig {
  webSearch: boolean;
}

export function loadConfig(cwd: string, agentDir?: string): OpenAIConfig {
  return {
    webSearch: false,
    ...readConfig(() => readPiUserSettings(agentDir), "global"),
    ...readConfig(() => readPiProjectSettings(cwd), "project"),
  };
}

export function isNativeWebSearchEnabled(config: OpenAIConfig | undefined, ctx: ExtensionContext): boolean {
  const model = ctx.model;
  return config?.webSearch === true && !!model && model.provider === "openai" && model.api === "openai-responses" &&
    model.baseUrl.replace(/\/$/, "") === "https://api.openai.com/v1" && ctx.modelRegistry.isUsingOAuth(model);
}

function readConfig(readSettings: () => unknown, scope: string): Partial<OpenAIConfig> {
  try {
    const root = readSettings();
    if (!isObject(root)) throw new Error("expected a JSON object");
    if (root.openai === undefined) return {};
    if (!isObject(root.openai)) throw new Error("openai must be an object");
    const webSearch = root.openai.webSearch;
    if (webSearch === undefined) return {};
    if (typeof webSearch !== "boolean") throw new Error("openai.webSearch must be a boolean");
    return { webSearch };
  } catch (error) {
    throw new Error(`Invalid OpenAI config in ${scope} settings.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
