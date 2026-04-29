import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getPiLabGlobalDir, getPiLabLocalDir } from "@pi-lab/utils";

export type Action = "allow" | "deny" | "ask";

export interface MatchCriteria {
  tool: string;
  params?: Record<string, string>; // key: param name, value: regex pattern
  paths?: string[];                 // glob or directory prefix patterns to match against pathParam
  pathParam?: string;               // which input key holds the path, defaults to "path"
}

export interface Rule {
  message?: string;
  priority?: number;
  match: MatchCriteria;
  action: Action;
}

export interface PermissionConfig {
  rules: Rule[];
}

function loadRulesFromFile(filePath: string): Rule[] {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content) as PermissionConfig;
    if (Array.isArray(parsed.rules)) {
      return parsed.rules;
    }
  } catch {
    // File doesn't exist or parse failed — skip silently
  }
  return [];
}

export function loadConfig(cwd: string, home = os.homedir()): PermissionConfig {
  const globalConfigPath = path.join(getPiLabGlobalDir(home), "permissions.json");
  const localConfigPath = path.join(getPiLabLocalDir(cwd), "permissions.json");

  const globalRules = loadRulesFromFile(globalConfigPath);
  const localRules = loadRulesFromFile(localConfigPath);

  return {
    rules: [...globalRules, ...localRules],
  };
}
