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
    properties?: { task?: { minLength?: number; type?: string } };
  };
  assert.deepEqual(parameters.required, ["task"]);
  assert.equal(parameters.properties?.task?.minLength, 1);
  assert.equal(parameters.properties?.task?.type, "string");
});

test("renders the task inline when collapsed and below the title when expanded", () => {
  let definition: Record<string, unknown> | undefined;
  const pi = {
    registerTool(tool: Record<string, unknown>) {
      definition = tool;
    },
  } as unknown as ExtensionAPI;

  registerSubagent(pi);

  const renderCall = definition?.renderCall as (
    args: { task: string },
    theme: {
      fg: (color: string, text: string) => string;
      bold: (text: string) => string;
    },
    context: { expanded: boolean; lastComponent?: unknown },
  ) => { render: (width: number) => string[] };
  const task = `Review ${"a".repeat(100)} trailing text`;
  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
  const collapsed = renderCall({ task }, theme, { expanded: false }).render(200).join("\n");

  assert.match(collapsed, new RegExp(`^Subagent ${task}`));

  const expanded = renderCall({ task }, theme, { expanded: true }).render(200).join("\n");

  assert.match(expanded, new RegExp(`^Subagent *\\n${task}`));

  const narrowCollapsed = renderCall(
    { task: "Inspect authentication implementation and report every security and correctness risk. ".repeat(4) },
    theme,
    { expanded: false },
  ).render(24);
  assert.equal(narrowCollapsed.length, 1);
  assert.match(narrowCollapsed[0] ?? "", /\.\.\./);
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
  ).render(200);
  assert.deepEqual(collapsed, []);

  const expanded = renderResult(
    { content: [{ type: "text", text: expandedOutput }] },
    { expanded: true, isPartial: false },
    theme,
    { isError: false },
  ).render(200).join("\n");
  assert.match(expanded, /^Result *\n/m);
  assert.doesNotMatch(expanded, /^Results/m);
  assert.match(expanded, /line 12/);
});
