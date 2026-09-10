import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import register from "./index.js";

type ToolRenderContext = Parameters<NonNullable<ToolDefinition["renderCall"]>>[2];

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

function setup() {
  let tool!: ToolDefinition;
  register({ registerTool: (definition: ToolDefinition) => { tool = definition; } } as ExtensionAPI);
  const context: ToolRenderContext = {
    args: {}, toolCallId: "image-1", invalidate() {}, lastComponent: undefined,
    state: {}, cwd: "/unused", executionStarted: false, argsComplete: false,
    isPartial: true, expanded: false, showImages: true, isError: false,
  };
  function render(args: Record<string, unknown>) {
    context.args = args;
    const component = tool.renderCall!(args, theme, context);
    context.lastComponent = component;
    return component.render(40).join("\n").trimEnd();
  }
  return { tool, context, render };
}

test("streams partial prompts and keeps them visible during generation", () => {
  const { context, render } = setup();
  assert.equal(render({}), "generate_image");
  assert.match(render({ prompt: "一个" }), /一个/);
  const component = context.lastComponent;
  assert.match(render({ prompt: "一个机器人" }), /一个机器人/);
  assert.equal(context.lastComponent, component);
  context.argsComplete = true;
  context.executionStarted = true;
  assert.match(render({ prompt: "一个机器人" }), /一个机器人/);
});

test("settled calls hide the prompt and leave result rendering unchanged", () => {
  const { tool, context, render } = setup();
  render({ prompt: "机器人" });
  context.isPartial = false;
  assert.equal(render({ prompt: "机器人" }), "generate_image");
  context.isError = true;
  assert.equal(render({ prompt: "机器人" }), "generate_image");
  assert.equal(tool.renderResult, undefined);
  assert.equal(tool.renderShell, undefined);
});

test("handles incomplete values and wraps long Chinese prompts", () => {
  const { render } = setup();
  assert.equal(render({ prompt: null }), "generate_image");
  const lines = render({ prompt: "可爱的机器人在月球上看地球。".repeat(20) }).split("\n");
  assert.ok(lines.length > 2);
  assert.ok(lines.every((line) => visibleWidth(line) <= 40));
});
