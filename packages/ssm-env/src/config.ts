import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

export interface SsmEnvConfig {
  profile?: string;
  region?: string;
  parameters: Record<string, string>;
}

function getProjectSettingsPath(cwd: string): string {
  return join(cwd, CONFIG_DIR_NAME, "settings.json");
}

function getGlobalSettingsPath(agentDir = getAgentDir()): string {
  return join(agentDir, "settings.json");
}

function readSettingsFile(filePath: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return {};
    throw error;
  }
}

export function readSsmEnvConfig(
  cwd = process.cwd(),
  agentDir = getAgentDir(),
  options: { includeProject?: boolean } = {},
): SsmEnvConfig | undefined {
  const globalSettings = readSettingsFile(getGlobalSettingsPath(agentDir));
  const projectSettings =
    options.includeProject === false
      ? undefined
      : readSettingsFile(getProjectSettingsPath(cwd));
  const raw =
    projectSettings && Object.hasOwn(projectSettings, "ssmEnv")
      ? projectSettings.ssmEnv
      : globalSettings.ssmEnv;

  if (raw === undefined) return undefined;
  if (!isPlainObject(raw)) {
    throw new Error("ssmEnv must be an object");
  }

  const parameters = raw.parameters;
  if (!isPlainObject(parameters) || Object.keys(parameters).length === 0) {
    throw new Error("ssmEnv.parameters must be a non-empty object");
  }

  const normalizedParameters: Record<string, string> = {};
  for (const [envName, parameterName] of Object.entries(parameters)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName)) {
      throw new Error(`ssmEnv.parameters contains invalid environment variable name: ${envName}`);
    }
    if (typeof parameterName !== "string" || parameterName.trim() === "") {
      throw new Error(`ssmEnv.parameters.${envName} must be a non-empty string`);
    }
    normalizedParameters[envName] = parameterName;
  }

  return {
    ...readOptionalString(raw, "profile"),
    ...readOptionalString(raw, "region"),
    parameters: normalizedParameters,
  };
}

function readOptionalString(
  value: Record<string, unknown>,
  key: "profile" | "region",
): Partial<Pick<SsmEnvConfig, "profile" | "region">> {
  const field = value[key];
  if (field === undefined) return {};
  if (typeof field !== "string" || field.trim() === "") {
    throw new Error(`ssmEnv.${key} must be a non-empty string`);
  }
  return { [key]: field };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
