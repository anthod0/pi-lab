import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export async function openaiImageHeaders(registry: ExtensionContext["modelRegistry"]): Promise<Headers> {
	let apiKey = process.env.OPENAI_API_KEY?.trim();
	if (!apiKey) {
		const auth = await registry.getProviderAuth("openai");
		if (auth?.source === "OAuth") throw new Error("OpenAI Images API requires an API key. Set OPENAI_API_KEY to keep using ChatGPT OAuth for chat.");
		if (auth?.auth.baseUrl && auth.auth.baseUrl.replace(/\/$/, "") !== "https://api.openai.com/v1") {
			throw new Error("Image generation supports the official OpenAI API endpoint only.");
		}
		apiKey = auth?.auth.apiKey;
	}
	if (!apiKey) throw new Error("Set OPENAI_API_KEY or configure an OpenAI API key in Pi before generating images.");
	return new Headers({ Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" });
}
