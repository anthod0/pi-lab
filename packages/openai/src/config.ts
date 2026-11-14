import { readPiProjectSettings, readPiUserSettings } from "@pi-lab/utils";
import { parseImageConfig, type ImageConfig } from "./images/capabilities";

export interface OpenAIConfig {
	fast: boolean;
	webSearch: boolean;
	optimizeLatency: boolean;
}

type ConfigSection = Partial<OpenAIConfig> & { imageGeneration?: unknown };

export function loadConfig(cwd: string, agentDir?: string): OpenAIConfig {
	const global = readSection(() => readPiUserSettings(agentDir), "global");
	const project = readSection(() => readPiProjectSettings(cwd), "project");
	return {
		fast: project.fast ?? global.fast ?? false,
		webSearch: project.webSearch ?? global.webSearch ?? false,
		optimizeLatency: project.optimizeLatency ?? global.optimizeLatency ?? false,
	};
}

export function loadImageConfig(cwd: string, agentDir?: string, projectTrusted = true): ImageConfig | false {
	function readImage(readSettings: () => unknown, scope: string): ImageConfig | false | undefined {
		const section = readSection(readSettings, scope);
		if (section.imageGeneration === undefined) return undefined;
		try {
			return parseImageConfig(section.imageGeneration);
		} catch (error) {
			throw new Error(`Invalid OpenAI image config in ${scope} settings.json: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	const global = readImage(() => readPiUserSettings(agentDir), "global");
	const project = projectTrusted ? readImage(() => readPiProjectSettings(cwd), "project") : undefined;
	return project ?? global ?? false;
}

function readSection(readSettings: () => unknown, scope: string): ConfigSection {
	try {
		const root = readSettings();
		if (!isObject(root)) throw new Error("expected a JSON object");
		if (root.openai === undefined) return {};
		if (!isObject(root.openai)) throw new Error("openai must be an object");
		const config: ConfigSection = {};
		for (const key of Object.keys(root.openai)) {
			if (key === "imageGeneration") {
				config.imageGeneration = root.openai[key];
				continue;
			}
			if (key !== "fast" && key !== "webSearch" && key !== "optimizeLatency") throw new Error(`unknown openai option: ${key}`);
			const value = root.openai[key];
			if (typeof value !== "boolean") throw new Error(`openai.${key} must be a boolean`);
			config[key] = value;
		}
		return config;
	} catch (error) {
		throw new Error(`Invalid OpenAI config in ${scope} settings.json: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
