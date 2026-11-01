import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type PiSettings = Record<string, unknown>;

function readJsonFile(filePath: string): PiSettings {
	try {
		return JSON.parse(readFileSync(filePath, "utf8")) as PiSettings;
	} catch (error) {
		const err = error as NodeJS.ErrnoException;
		if (err.code === "ENOENT") {
			return {};
		}
		throw error;
	}
}

export function readPiProjectSettings(cwd = process.cwd()): PiSettings {
	return readJsonFile(join(cwd, ".pi", "settings.json"));
}

export function readPiUserSettings(agentDir = getAgentDir()): PiSettings {
	return readJsonFile(join(agentDir, "settings.json"));
}

export interface ReadMergedPiSettingsOptions {
	cwd?: string;
	agentDir?: string;
}

export function mergePiSettings(userSettings: PiSettings = {}, projectSettings: PiSettings = {}): PiSettings {
	return deepMerge(userSettings, projectSettings);
}

export function readMergedPiSettings(options: ReadMergedPiSettingsOptions = {}): PiSettings {
	return mergePiSettings(
		readPiUserSettings(options.agentDir),
		readPiProjectSettings(options.cwd),
	);
}

function deepMerge(base: PiSettings, override: PiSettings): PiSettings {
	const result: PiSettings = { ...base };
	for (const [key, value] of Object.entries(override)) {
		if (value === undefined) continue;

		const existing = result[key];
		if (isPlainObject(existing) && isPlainObject(value)) {
			result[key] = deepMerge(existing, value);
		} else {
			result[key] = value;
		}
	}
	return result;
}

function isPlainObject(value: unknown): value is PiSettings {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
