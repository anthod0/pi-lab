import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { getPiLabGlobalDir, getPiLabLocalDir } from "@pi-lab/utils";

export type NotifyConfig = {
	enable: boolean;
	script?: string;
};

type RawNotifyConfig = {
	enable?: unknown;
	script?: unknown;
};

export function loadConfig(cwd = process.cwd(), home = homedir()): NotifyConfig {
	const globalNotify = readNotifyJson(join(getPiLabGlobalDir(home), "notify.json"));
	const localNotify = readNotifyJson(join(getPiLabLocalDir(cwd), "notify.json"));
	return normalizeConfig({ ...globalNotify, ...localNotify }, cwd, home);
}

function readNotifyJson(filePath: string): RawNotifyConfig {
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
		if (!isPlainObject(parsed)) return {};
		const notify = parsed.notify;
		return isPlainObject(notify) ? notify : {};
	} catch (error) {
		const err = error as NodeJS.ErrnoException;
		if (err.code === "ENOENT") return {};
		throw error;
	}
}

function normalizeConfig(raw: RawNotifyConfig, cwd: string, home: string): NotifyConfig {
	const config: NotifyConfig = { enable: typeof raw.enable === "boolean" ? raw.enable : true };
	if (typeof raw.script === "string" && raw.script.trim() !== "") {
		config.script = resolveScriptPath(raw.script, cwd, home);
	}
	return config;
}

function resolveScriptPath(script: string, cwd: string, home: string): string {
	if (script === "~") return home;
	if (script.startsWith("~/")) return join(home, script.slice(2));
	if (isAbsolute(script)) return script;
	return resolve(cwd, script);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
