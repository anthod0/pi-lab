import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerSubagent from "./index.js";

test("registers only the minimal subagent schema without prompt injection", () => {
  let definition: Record<string, unknown> | undefined;
  const pi = {
    registerTool(tool: Record<string, unknown>) {
      definition = tool;
    },
  } as unknown as ExtensionAPI;

  registerSubagent(pi);

  assert.equal(definition?.name, "subagent");
  assert.equal(definition?.promptSnippet, undefined);
  assert.equal(definition?.promptGuidelines, undefined);
  assert.deepEqual(Object.keys(definition ?? {}).sort(), [
    "description",
    "execute",
    "label",
    "name",
    "parameters",
    "renderCall",
  ]);

  const parameters = definition?.parameters as {
    required?: string[];
    properties?: { tasks?: { minItems?: number; items?: { type?: string } } };
  };
  assert.deepEqual(parameters.required, ["tasks"]);
  assert.equal(parameters.properties?.tasks?.minItems, 1);
  assert.equal(parameters.properties?.tasks?.items?.type, "string");
});

test("renders a compact summary for every task prompt", () => {
  let definition: Record<string, unknown> | undefined;
  const pi = {
    registerTool(tool: Record<string, unknown>) {
      definition = tool;
    },
  } as unknown as ExtensionAPI;

  registerSubagent(pi);

  const renderCall = definition?.renderCall as (
    args: { tasks: string[] },
    theme: {
      fg: (color: string, text: string) => string;
      bold: (text: string) => string;
    },
    context: { lastComponent?: unknown },
  ) => { render: (width: number) => string[] };
  const component = renderCall(
    {
      tasks: [
        "Inspect   authentication\nimplementation and report risks.",
        `Review ${"a".repeat(100)} trailing text`,
      ],
    },
    {
      fg: (_color, text) => text,
      bold: (text) => text,
    },
    {},
  );
  const rendered = component.render(200).join("\n");

  assert.match(rendered, /^Subagent 2 tasks/m);
  assert.match(rendered, /1\. Inspect authentication implementation and report risks\./);
  assert.match(rendered, /2\. Review a+…/);
  assert.doesNotMatch(rendered, /trailing text/);
});
