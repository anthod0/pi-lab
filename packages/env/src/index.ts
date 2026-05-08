import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { loadGlobalEnv } from "./load";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async () => {
    loadGlobalEnv(process.env);
  });
}
