import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  getPiLabGlobalDir,
  getPiLabLocalDir,
  readPiProjectSettings,
  readPiUserSettings,
  type PiSettings,
} from "@pi-lab/utils";

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

function extractSettingsRules(settings: PiSettings): Rule[] {
  const permissions = settings.permissions;
  if (typeof permissions !== "object" || permissions === null) {
    return [];
  }

  const rules = (permissions as Partial<PermissionConfig>).rules;
  return Array.isArray(rules) ? rules : [];
}

function loadRulesFromSettings(readSettings: () => PiSettings): Rule[] {
  try {
    return extractSettingsRules(readSettings());
  } catch {
    // Keep permissions loading best-effort, matching legacy parse behavior.
    return [];
  }
}

function loadRulesWithLegacyPriority(
  legacyConfigPath: string,
  readSettings: () => PiSettings,
): Rule[] {
  if (fs.existsSync(legacyConfigPath)) {
    return loadRulesFromFile(legacyConfigPath);
  }
  return loadRulesFromSettings(readSettings);
}

export function loadConfig(cwd: string, home = os.homedir()): PermissionConfig {
  const globalConfigPath = path.join(getPiLabGlobalDir(home), "permissions.json");
  const localConfigPath = path.join(getPiLabLocalDir(cwd), "permissions.json");

  const globalRules = loadRulesWithLegacyPriority(globalConfigPath, () =>
    readPiUserSettings(home),
  );
  const localRules = loadRulesWithLegacyPriority(localConfigPath, () =>
    readPiProjectSettings(cwd),
  );

  return {
    rules: [...globalRules, ...localRules],
  };
}
