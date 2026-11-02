import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readPiProjectSettings, readPiUserSettings, type PiSettings } from "@pi-lab/utils";

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

function extractSettingsEnv(settings: PiSettings): SettingsEnv {
  if (
    typeof settings.env !== "object" ||
    settings.env === null ||
    Array.isArray(settings.env)
  ) {
    return {};
  }

  const env: SettingsEnv = {};
  for (const [key, value] of Object.entries(settings.env)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

export function readSettingsEnv(
  cwd = process.cwd(),
  agentDir = getAgentDir(),
  options: { includeProject?: boolean } = {},
): SettingsEnv {
  return {
    ...extractSettingsEnv(readPiUserSettings(agentDir)),
    ...(options.includeProject === false
      ? {}
      : extractSettingsEnv(readPiProjectSettings(cwd))),
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
