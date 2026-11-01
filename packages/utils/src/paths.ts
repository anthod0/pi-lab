import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * Returns the global pi-lab directory, used for legacy configuration and plugin data.
 * Prefer <agentDir>/settings.json for plugin configuration.
 */
export function getPiLabGlobalDir(agentDir = getAgentDir()): string {
	return join(agentDir, "pi-lab");
}

export function getPiLabGlobalTmpDir(name?: string, agentDir?: string): string {
	const tmpDir = join(getPiLabGlobalDir(agentDir), "tmp");
	return name ? join(tmpDir, name) : tmpDir;
}

/**
 * Returns the local pi-lab directory, used for legacy configuration and plugin data.
 * Prefer <cwd>/.pi/settings.json for plugin configuration.
 */
export function getPiLabLocalDir(cwd = process.cwd()): string {
	return join(cwd, ".pi", "pi-lab");
}

export function getPiLabLocalTmpDir(name?: string, cwd = process.cwd()): string {
	const tmpDir = join(getPiLabLocalDir(cwd), "tmp");
	return name ? join(tmpDir, name) : tmpDir;
}
