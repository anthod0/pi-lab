import assert from "node:assert/strict";
import test from "node:test";

import { interpolateEnv } from "./interpolate";

test("composes multiple environment references without changing the source", () => {
  const source = Object.freeze({ HOST: "gateway.example", KEY: "secret", EMPTY: "" });
  assert.deepEqual(interpolateEnv("https://${HOST}/${KEY}/${EMPTY}", source), {
    value: "https://gateway.example/secret/",
    missingVariables: [],
  });
});

for (const [input, source, expected] of [
  ["${MISSING:-127.0.0.1}", {}, "127.0.0.1"],
  ["${EMPTY:-fallback}", { EMPTY: "" }, "fallback"],
  ["${VALUE:-fallback}", { VALUE: "0" }, "0"],
  ["${MISSING:-}", {}, ""],
  ["${MISSING:-line one\nline two}", {}, "line one\nline two"],
] as const) {
  test(`uses literal defaults: ${JSON.stringify(input)}`, () => {
    assert.deepEqual(interpolateEnv(input, source), {
      value: expected,
      missingVariables: [],
    });
  });
}

test("keeps missing references and reports names without including values", () => {
  assert.deepEqual(interpolateEnv("secret-prefix/${MISSING}/${OTHER}/${MISSING}", {}), {
    value: "secret-prefix/${MISSING}/${OTHER}/${MISSING}",
    missingVariables: ["MISSING", "OTHER"],
  });
});

test("escaped references are literal even when missing or given defaults", () => {
  assert.deepEqual(interpolateEnv("$${SET} $${MISSING} $${MISSING:-fallback} ${SET}", { SET: "value" }), {
    value: "${SET} ${MISSING} ${MISSING:-fallback} value",
    missingVariables: [],
  });
});

test("inserted environment contents are never expanded or executed", () => {
  const payload = "${OTHER} $${OTHER} $(printf injected) `printf injected` $&\nNEXT=value";
  assert.deepEqual(interpolateEnv("prefix:${VALUE}", { VALUE: payload, OTHER: "secret" }), {
    value: `prefix:${payload}`,
    missingVariables: [],
  });
});

test("shell syntax and command-like defaults are only text", () => {
  const input = "$VALUE $(printf injected) `printf injected` ${MISSING:-$(printf fallback)}";
  assert.deepEqual(interpolateEnv(input, { VALUE: "secret" }), {
    value: "$VALUE $(printf injected) `printf injected` $(printf fallback)",
    missingVariables: [],
  });
});

for (const input of [
  "${MISSING:-${VALUE}}",
  "${MISSING:-prefix${VALUE:-${OTHER}}}",
  "${VALUE:-${OTHER}}",
  "${MISSING:-$${VALUE}}",
  "${${VALUE}}",
  "${1VALUE}",
  "${VALUE-NAME}",
  "${VALUE:+fallback}",
  "${VALUE",
  "$${VALUE",
]) {
  test(`leaves unsupported or incomplete expressions literal: ${input}`, () => {
    assert.deepEqual(interpolateEnv(input, { VALUE: "secret", OTHER: "other-secret" }), {
      value: input,
      missingVariables: [],
    });
  });
}

test("continues expanding valid references after an unsupported expression", () => {
  assert.deepEqual(interpolateEnv("${MISSING:-${VALUE}}/${VALUE}", { VALUE: "value" }), {
    value: "${MISSING:-${VALUE}}/value",
    missingVariables: [],
  });
});

test("does not resolve inherited object properties as environment variables", () => {
  const source = Object.create({ INHERITED: "secret" }) as NodeJS.ProcessEnv;
  assert.deepEqual(interpolateEnv("${INHERITED}/${constructor}/${__proto__}", source), {
    value: "${INHERITED}/${constructor}/${__proto__}",
    missingVariables: ["INHERITED", "constructor", "__proto__"],
  });
});
