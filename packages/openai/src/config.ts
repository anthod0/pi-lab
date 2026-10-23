import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPiLabGlobalDir, getPiLabLocalDir } from "@pi-lab/utils";

export interface OpenAIConfig {
	fast: boolean;
	webSearch: boolean;
}

export function loadConfig(cwd: string, home?: string): OpenAIConfig {
	return {
		fast: false,
		webSearch: false,
		...readConfig(join(getPiLabGlobalDir(home), "openai.json")),
		...readConfig(join(getPiLabLocalDir(cwd), "openai.json")),
	};
}

function readConfig(path: string): Partial<OpenAIConfig> {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}

	try {
		const root: unknown = JSON.parse(text);
		if (!isObject(root)) throw new Error("expected a JSON object");
		if (root.openai === undefined) return {};
		if (!isObject(root.openai)) throw new Error("openai must be an object");
		const config: Partial<OpenAIConfig> = {};
		for (const key of Object.keys(root.openai)) {
			if (key !== "fast" && key !== "webSearch") throw new Error(`unknown openai option: ${key}`);
			const value = root.openai[key];
			if (typeof value !== "boolean") throw new Error(`openai.${key} must be a boolean`);
			config[key] = value;
		}
		return config;
	} catch (error) {
		throw new Error(`Invalid OpenAI config ${path}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
