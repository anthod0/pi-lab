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

export function readPiProjectSettings(): PiSettings {
	return readJsonFile(join(process.cwd(), ".pi", "settings.json"));
}

export function readPiUserSettings(): PiSettings {
	return readJsonFile(join(homedir(), ".pi", "agent", "settings.json"));
}
