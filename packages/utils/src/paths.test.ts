import assert from "node:assert/strict";
import test from "node:test";

import {
	getPiLabGlobalDir,
	getPiLabGlobalTmpDir,
	getPiLabLocalDir,
	getPiLabLocalTmpDir,
} from "./paths.js";

test("getPiLabGlobalDir resolves ~/.pi/agent/pi-lab", () => {
	assert.equal(getPiLabGlobalDir("/tmp/home"), "/tmp/home/.pi/agent/pi-lab");
});

test("getPiLabGlobalTmpDir resolves global tmp directory with optional name", () => {
	assert.equal(
		getPiLabGlobalTmpDir(undefined, "/tmp/home"),
		"/tmp/home/.pi/agent/pi-lab/tmp",
	);
	assert.equal(
		getPiLabGlobalTmpDir("webfetch", "/tmp/home"),
		"/tmp/home/.pi/agent/pi-lab/tmp/webfetch",
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
