import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { readSettingsEnv } from "./config";
import { loadGlobalEnv } from "./load";

function isProjectTrusted(ctx: unknown): boolean {
  const maybeTrustedContext = ctx as { isProjectTrusted?: () => boolean };
  return maybeTrustedContext.isProjectTrusted?.() ?? true;
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    loadGlobalEnv(process.env, undefined, {
      settingsEnv: readSettingsEnv(ctx.cwd, undefined, {
        includeProject: isProjectTrusted(ctx),
      }),
    });
  });
}
