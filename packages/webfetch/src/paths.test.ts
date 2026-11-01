import assert from "node:assert/strict";
import test from "node:test";

import { getBinaryTempDir } from "./paths";

test("getBinaryTempDir resolves pi-lab/tmp/webfetch beneath the supplied agent directory", () => {
	assert.equal(
		getBinaryTempDir("/tmp/custom agent"),
		"/tmp/custom agent/pi-lab/tmp/webfetch",
	);
});
