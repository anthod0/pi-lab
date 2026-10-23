import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { OpenAIConfig } from "./config";

export { loadConfig, type OpenAIConfig } from "./config";

/** Keep these conditions aligned with websearch's independent native-search policy. */
export function isOpenAIChatGPTModel(ctx: ExtensionContext): boolean {
	const model = ctx.model;
	return !!model && model.provider === "openai" && model.api === "openai-responses" &&
		model.baseUrl.replace(/\/$/, "") === "https://api.openai.com/v1" && ctx.modelRegistry.isUsingOAuth(model);
}

export function isNativeWebSearchEnabled(config: OpenAIConfig | undefined, ctx: ExtensionContext): boolean {
	return config?.webSearch === true && isOpenAIChatGPTModel(ctx);
}
