import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { readSettingsEnv } from "./config";
import { loadGlobalEnv, mergeEnv } from "./load";

function isProjectTrusted(ctx: unknown): boolean {
  const maybeTrustedContext = ctx as { isProjectTrusted?: () => boolean };
  return maybeTrustedContext.isProjectTrusted?.() ?? true;
}

export default function (pi: ExtensionAPI) {
  // Pi awaits each factory before importing the next extension. Only global
  // configuration is safe to read before a trusted session context exists.
  const globalEnv: NodeJS.ProcessEnv = {};
  loadGlobalEnv(globalEnv, undefined, {
    settingsEnv: readSettingsEnv(undefined, undefined, { includeProject: false }),
  });
  const { loadedKeys } = mergeEnv(globalEnv, process.env);
  const injectedValues = new Map(loadedKeys.map((key) => [key, process.env[key]]));

  pi.on("session_start", async (_event, ctx) => {
    const settingsEnv = readSettingsEnv(ctx.cwd, undefined, {
      includeProject: isProjectTrusted(ctx),
    });

    const sessionEnv: NodeJS.ProcessEnv = {};
    loadGlobalEnv(sessionEnv, undefined, { settingsEnv });

    // Only update values we still own. A deletion is also a later change, not
    // a missing value to refill. Track session injections for subsequent events.
    for (const [key, value] of Object.entries(sessionEnv)) {
      if (injectedValues.has(key)) {
        if (process.env[key] !== injectedValues.get(key)) continue;
      } else if (process.env[key] !== undefined) {
        continue;
      }
      process.env[key] = value;
      injectedValues.set(key, value);
    }
  });
}
