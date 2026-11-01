import { getPiLabGlobalTmpDir } from "@pi-lab/utils";

export function getBinaryTempDir(agentDir?: string): string {
	return getPiLabGlobalTmpDir("webfetch", agentDir);
}
