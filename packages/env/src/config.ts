import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface GlobalEnvFile {
  exists: boolean;
  path: string;
  content?: string;
}

export function getGlobalEnvPath(homeDir = homedir()): string {
  return join(homeDir, ".pi", "agent", ".env");
}

export function getLegacyGlobalEnvPath(homeDir = homedir()): string {
  return join(homeDir, ".pi", "agent", "pi-lab", ".env");
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
