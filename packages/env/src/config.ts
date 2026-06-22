import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface GlobalEnvFile {
  exists: boolean;
  path: string;
  content?: string;
}

export type SettingsEnv = Record<string, string>;

export function getGlobalEnvPath(homeDir = homedir()): string {
  return join(homeDir, ".pi", "agent", ".env");
}

export function getLegacyGlobalEnvPath(homeDir = homedir()): string {
  return join(homeDir, ".pi", "agent", "pi-lab", ".env");
}

function getProjectSettingsPath(cwd: string): string {
  return join(cwd, ".pi", "settings.json");
}

function getGlobalSettingsPath(agentDir = getAgentDir()): string {
  return join(agentDir, "settings.json");
}

function readEnvFromSettingsFile(filePath: string): SettingsEnv {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return {};
    throw error;
  }

  const settings = JSON.parse(content) as { env?: unknown };
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
    ...readEnvFromSettingsFile(getGlobalSettingsPath(agentDir)),
    ...(options.includeProject === false
      ? {}
      : readEnvFromSettingsFile(getProjectSettingsPath(cwd))),
  };
}

function getLegacyGlobalEnvPathFor(filePath: string): string {
  return join(dirname(filePath), "pi-lab", ".env");
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

  const legacyEnvFile = tryReadEnvFile(getLegacyGlobalEnvPathFor(filePath));
  return legacyEnvFile.exists ? legacyEnvFile : envFile;
}
