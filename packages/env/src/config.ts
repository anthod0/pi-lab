import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readPiProjectSettings, readPiUserSettings, type PiSettings } from "@pi-lab/utils";

import { interpolateEnv } from "./interpolate";

export interface GlobalEnvFile {
  exists: boolean;
  path: string;
  content?: string;
}

export type SettingsEnv = Record<string, string>;

export function getGlobalEnvPath(agentDir = getAgentDir()): string {
  return join(agentDir, ".env");
}

export function getLegacyGlobalEnvPath(agentDir = getAgentDir()): string {
  return join(agentDir, "pi-lab", ".env");
}

function extractSettingsEnv(
  settings: PiSettings,
  source: Readonly<NodeJS.ProcessEnv>,
  filePath: string,
): SettingsEnv {
  if (
    typeof settings.env !== "object" ||
    settings.env === null ||
    Array.isArray(settings.env)
  ) {
    return {};
  }

  const env: SettingsEnv = {};
  for (const [key, value] of Object.entries(settings.env)) {
    if (typeof value !== "string") continue;
    const result = interpolateEnv(value, source);
    env[key] = result.value;
    for (const variable of result.missingVariables) {
      console.warn("[env] Undefined environment variable", { path: filePath, key, variable });
    }
  }
  return env;
}

export function readSettingsEnv(
  cwd = process.cwd(),
  agentDir = getAgentDir(),
  options: { includeProject?: boolean; sourceEnv?: Readonly<NodeJS.ProcessEnv> } = {},
): SettingsEnv {
  const source = options.sourceEnv ?? process.env;
  return {
    ...extractSettingsEnv(readPiUserSettings(agentDir), source, join(agentDir, "settings.json")),
    ...(options.includeProject === false
      ? {}
      : extractSettingsEnv(readPiProjectSettings(cwd), source, join(cwd, ".pi", "settings.json"))),
  };
}

function tryReadEnvFile(filePath: string): GlobalEnvFile {
  try {
    return {
      exists: true,
      path: filePath,
      content: readFileSync(filePath, "utf8"),
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return { exists: false, path: filePath };
    }
    throw error;
  }
}

export function readGlobalEnvFile(filePath = getGlobalEnvPath()): GlobalEnvFile {
  const envFile = tryReadEnvFile(filePath);
  if (envFile.exists) return envFile;

  const legacyEnvFile = tryReadEnvFile(getLegacyGlobalEnvPath(dirname(filePath)));
  return legacyEnvFile.exists ? legacyEnvFile : envFile;
}
