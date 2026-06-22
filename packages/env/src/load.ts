import { parse } from "@dotenvx/dotenvx";

import { getGlobalEnvPath, readGlobalEnvFile, type SettingsEnv } from "./config";

export interface LoadResult {
  path: string;
  exists: boolean;
  loadedKeys: string[];
  skippedKeys: string[];
}

export interface LoadGlobalEnvOptions {
  settingsEnv?: SettingsEnv;
}

const DISPLAY_PATH = "~/.pi/agent/.env";

export function mergeEnv(
  parsed: Record<string, string | undefined>,
  target: NodeJS.ProcessEnv,
): { loadedKeys: string[]; skippedKeys: string[] } {
  const loadedKeys: string[] = [];
  const skippedKeys: string[] = [];

  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") continue;

    if (target[key] !== undefined) {
      skippedKeys.push(key);
      continue;
    }

    target[key] = value;
    loadedKeys.push(key);
  }

  return { loadedKeys, skippedKeys };
}

export function loadGlobalEnv(
  target: NodeJS.ProcessEnv = process.env,
  filePath = getGlobalEnvPath(),
  options: LoadGlobalEnvOptions = {},
): LoadResult {
  try {
    const settingsResult = mergeEnv(options.settingsEnv ?? {}, target);
    const envFile = readGlobalEnvFile(filePath);

    if (!envFile.exists || envFile.content === undefined) {
      return {
        path: envFile.path,
        exists: false,
        loadedKeys: settingsResult.loadedKeys,
        skippedKeys: settingsResult.skippedKeys,
      };
    }

    const parsed = parse(envFile.content, { processEnv: {} });
    const fileResult = mergeEnv(parsed, target);

    return {
      path: envFile.path,
      exists: true,
      loadedKeys: [...settingsResult.loadedKeys, ...fileResult.loadedKeys],
      skippedKeys: [...settingsResult.skippedKeys, ...fileResult.skippedKeys],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load ${DISPLAY_PATH}: ${message}`, {
      cause: error,
    });
  }
}
