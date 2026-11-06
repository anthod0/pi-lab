import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";

export async function codexImageHeaders(registry: ExtensionContext["modelRegistry"]): Promise<Headers> {
	const auth = await registry.getProviderAuth("openai-codex");
	if (auth?.source !== "OAuth" || !auth.auth.apiKey) throw new Error("Log in with Pi /login → OpenAI Codex (legacy) to generate images.");
	let accountId: unknown;
	try {
		const claims = JSON.parse(Buffer.from(auth.auth.apiKey.split(".")[1], "base64url").toString("utf8"));
		accountId = claims["https://api.openai.com/auth"]?.chatgpt_account_id;
	} catch {
		throw new Error("Cannot read the Codex account ID. Log in again with OpenAI Codex (legacy).");
	}
	if (typeof accountId !== "string" || !accountId) throw new Error("Codex login is missing an account ID.");
	return new Headers({
		Authorization: `Bearer ${auth.auth.apiKey}`,
		"chatgpt-account-id": accountId,
		"Content-Type": "application/json",
		Accept: "application/json",
		originator: "pi",
		"User-Agent": "pi",
		"x-codex-image-turn-id": randomUUID(),
	});
}
