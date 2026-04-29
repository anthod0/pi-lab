import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getPiLabGlobalDir } from "@pi-lab/utils";

export interface GlobalEnvFile {
  exists: boolean;
  content?: string;
}

export function getGlobalEnvPath(homeDir = homedir()): string {
  return join(getPiLabGlobalDir(homeDir), ".env");
}

export function readGlobalEnvFile(filePath = getGlobalEnvPath()): GlobalEnvFile {
  try {
    return {
      exists: true,
      content: readFileSync(filePath, "utf8"),
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return { exists: false };
    }
    throw error;
  }
}
