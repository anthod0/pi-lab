import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempDisposableSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	getPiLabGlobalDir,
	getPiLabGlobalTmpDir,
	getPiLabLocalDir,
	getPiLabLocalTmpDir,
} from "./paths.js";

for (const custom of [false, true]) {
	test(`global plugin paths follow ${custom ? "PI_CODING_AGENT_DIR" : "the default agent directory"}`, (t) => {
		const testRoot = mkdtempDisposableSync(join(tmpdir(), "pi-lab-paths-"));
		t.after(() => testRoot.remove());
		const agentDir = custom ? join(testRoot.path, "custom agent") : join(homedir(), ".pi", "agent");
		const env = { ...process.env };
		if (custom) env.PI_CODING_AGENT_DIR = agentDir;
		else delete env.PI_CODING_AGENT_DIR;
		const result = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
			import { getPiLabGlobalDir, getPiLabGlobalTmpDir } from ${JSON.stringify(new URL("./paths.ts", import.meta.url).href)};
			console.log(JSON.stringify([getPiLabGlobalDir(), getPiLabGlobalTmpDir("webfetch")]));
		`], { env, encoding: "utf8" });
		assert.deepEqual(JSON.parse(result), [join(agentDir, "pi-lab"), join(agentDir, "pi-lab", "tmp", "webfetch")]);
	});
}

test("getPiLabGlobalDir resolves pi-lab beneath the supplied agent directory", () => {
	assert.equal(getPiLabGlobalDir("/tmp/custom agent"), "/tmp/custom agent/pi-lab");
});

test("getPiLabGlobalTmpDir resolves global tmp directory with optional name", () => {
	assert.equal(
		getPiLabGlobalTmpDir(undefined, "/tmp/custom agent"),
		"/tmp/custom agent/pi-lab/tmp",
	);
	assert.equal(
		getPiLabGlobalTmpDir("webfetch", "/tmp/custom agent"),
		"/tmp/custom agent/pi-lab/tmp/webfetch",
	);
});

test("getPiLabLocalDir resolves <cwd>/.pi/pi-lab", () => {
	assert.equal(getPiLabLocalDir("/tmp/project"), "/tmp/project/.pi/pi-lab");
});

test("getPiLabLocalTmpDir resolves local tmp directory with optional name", () => {
	assert.equal(
		getPiLabLocalTmpDir(undefined, "/tmp/project"),
		"/tmp/project/.pi/pi-lab/tmp",
	);
	assert.equal(
		getPiLabLocalTmpDir("cache", "/tmp/project"),
		"/tmp/project/.pi/pi-lab/tmp/cache",
	);
});
