import { parse } from "@dotenvx/dotenvx";

import { getGlobalEnvPath, readGlobalEnvFile } from "./config";

export interface LoadResult {
  path: string;
  exists: boolean;
  loadedKeys: string[];
  skippedKeys: string[];
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
): LoadResult {
  try {
    const envFile = readGlobalEnvFile(filePath);

    if (!envFile.exists || envFile.content === undefined) {
      return {
        path: envFile.path,
        exists: false,
        loadedKeys: [],
        skippedKeys: [],
      };
    }

    const parsed = parse(envFile.content, { processEnv: {} });
    const { loadedKeys, skippedKeys } = mergeEnv(parsed, target);

    return {
      path: envFile.path,
      exists: true,
      loadedKeys,
      skippedKeys,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load ${DISPLAY_PATH}: ${message}`, {
      cause: error,
    });
  }
}
