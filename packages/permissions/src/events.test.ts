import assert from "node:assert/strict";
import test from "node:test";

import { serializeRule } from "./events.js";

const rule = {
	message: "Block dangerous commands",
	priority: 10,
	action: "deny" as const,
	match: {
		tool: "bash",
		params: { command: "rm\\s+-rf" },
		paths: ["~/secret/**"],
		pathParam: "path",
	},
};

test("serializeRule preserves only configured safe rule fields", () => {
	const serialized = serializeRule(rule);

	assert.deepEqual(serialized, rule);
	assert.equal(JSON.stringify(serialized).includes("/tmp/actual-secret"), false);
	assert.equal(Object.hasOwn(serialized, "input"), false);
});
