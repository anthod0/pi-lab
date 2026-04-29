import { homedir } from "node:os";
import { join } from "node:path";

export function getPiLabGlobalDir(home = homedir()): string {
	return join(home, ".pi", "agent", "pi-lab");
}

export function getPiLabGlobalTmpDir(name?: string, home = homedir()): string {
	const tmpDir = join(getPiLabGlobalDir(home), "tmp");
	return name ? join(tmpDir, name) : tmpDir;
}

export function getPiLabLocalDir(cwd = process.cwd()): string {
	return join(cwd, ".pi", "pi-lab");
}

export function getPiLabLocalTmpDir(name?: string, cwd = process.cwd()): string {
	const tmpDir = join(getPiLabLocalDir(cwd), "tmp");
	return name ? join(tmpDir, name) : tmpDir;
}
