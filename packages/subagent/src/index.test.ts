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
    "renderResult",
  ]);

  const parameters = definition?.parameters as {
    required?: string[];
    properties?: { tasks?: { minItems?: number; items?: { type?: string } } };
  };
  assert.deepEqual(parameters.required, ["tasks"]);
  assert.equal(parameters.properties?.tasks?.minItems, 1);
  assert.equal(parameters.properties?.tasks?.items?.type, "string");
});

test("hides task prompts until expanded, then renders them without truncation", () => {
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
    context: { expanded: boolean; lastComponent?: unknown },
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
    { expanded: false },
  );
  const rendered = component.render(200).join("\n");

  assert.match(rendered, /^Input 2 tasks/m);
  assert.doesNotMatch(rendered, /Inspect authentication/);
  assert.doesNotMatch(rendered, /Review/);

  const expanded = renderCall(
    { tasks: [`Review ${"a".repeat(100)} trailing text`] },
    {
      fg: (_color, text) => text,
      bold: (text) => text,
    },
    { expanded: true },
  ).render(200).join("\n");

  assert.match(expanded, /^Input 1 task/m);
  assert.match(expanded, new RegExp(`Review ${"a".repeat(100)} trailing text`));
});

test("renders output separately and expands it on demand", () => {
  let definition: Record<string, unknown> | undefined;
  const pi = {
    registerTool(tool: Record<string, unknown>) {
      definition = tool;
    },
  } as unknown as ExtensionAPI;

  registerSubagent(pi);

  const renderResult = definition?.renderResult as (
    result: { content: Array<{ type: "text"; text: string }> },
    options: { expanded: boolean; isPartial: boolean },
    theme: {
      fg: (color: string, text: string) => string;
      bold: (text: string) => string;
    },
    context: { isError: boolean; lastComponent?: unknown },
  ) => { render: (width: number) => string[] };
  const collapsedOutput = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join("\n");
  const expandedOutput = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n");
  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };

  const collapsed = renderResult(
    { content: [{ type: "text", text: collapsedOutput }] },
    { expanded: false, isPartial: false },
    theme,
    { isError: false },
  ).render(200).join("\n");
  assert.match(collapsed, /^Output/m);
  assert.match(collapsed, /line 10/);

  const expanded = renderResult(
    { content: [{ type: "text", text: expandedOutput }] },
    { expanded: true, isPartial: false },
    theme,
    { isError: false },
  ).render(200).join("\n");
  assert.match(expanded, /line 12/);
});
