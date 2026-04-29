import { homedir } from "node:os";
import { getPiLabGlobalTmpDir } from "@pi-lab/utils";

export function getBinaryTempDir(home = homedir()): string {
	return getPiLabGlobalTmpDir("webfetch", home);
}
