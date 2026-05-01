import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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

export function readPiUserSettings(home = homedir()): PiSettings {
	return readJsonFile(join(home, ".pi", "agent", "settings.json"));
}
