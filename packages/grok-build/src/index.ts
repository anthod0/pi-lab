import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGrokBuildTool } from "./tool.js";

export default function (pi: ExtensionAPI) {
  registerGrokBuildTool(pi);
}

export { registerGrokBuildTool } from "./tool.js";
export { buildGrokArgs, normalizePrompt, runGrokBuild } from "./grok.js";
export type { GrokBuildOptions, GrokBuildParams, GrokBuildResult, GrokRunner, GrokRunnerResult } from "./grok.js";
