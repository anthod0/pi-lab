import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { readSettingsEnv } from "./config";
import { loadGlobalEnv, mergeEnv } from "./load";

function isProjectTrusted(ctx: unknown): boolean {
  const maybeTrustedContext = ctx as { isProjectTrusted?: () => boolean };
  return maybeTrustedContext.isProjectTrusted?.() ?? true;
}

export default function (
  pi: ExtensionAPI,
  paths: { agentDir?: string; envFile?: string } = {},
) {
  // Pi awaits each factory before importing the next extension. Only global
  // configuration is safe to read before a trusted session context exists.
  const globalEnv: NodeJS.ProcessEnv = {};
  loadGlobalEnv(globalEnv, paths.envFile, {
    settingsEnv: readSettingsEnv(undefined, paths.agentDir, { includeProject: false }),
  });
  const { loadedKeys } = mergeEnv(globalEnv, process.env);
  const injectedValues = new Map(loadedKeys.map((key) => [key, process.env[key]]));
  const relinquishedKeys = new Set<string>();

  pi.on("session_start", async (_event, ctx) => {
    // Once another extension takes control, never reclaim the key in this factory,
    // even if its value later matches ours or it disappears from configuration.
    for (const [key, value] of injectedValues) {
      if (process.env[key] !== value) {
        injectedValues.delete(key);
        relinquishedKeys.add(key);
      }
    }

    const settingsEnv = readSettingsEnv(ctx.cwd, paths.agentDir, {
      includeProject: isProjectTrusted(ctx),
    });

    const sessionEnv: NodeJS.ProcessEnv = {};
    loadGlobalEnv(sessionEnv, paths.envFile, { settingsEnv });

    // Only update values we still own. A deletion is also a later change, not
    // a missing value to refill. Track session injections for subsequent events.
    for (const [key, value] of Object.entries(sessionEnv)) {
      if (relinquishedKeys.has(key)) continue;
      if (!injectedValues.has(key) && process.env[key] !== undefined) continue;
      process.env[key] = value;
      injectedValues.set(key, value);
    }
  });
}
