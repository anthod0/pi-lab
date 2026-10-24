import assert from "node:assert/strict";
import { mkdirSync, mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { Type } from "typebox";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import openai from "../../openai/src/index";
import websearch from "./index";

async function setup(t: TestContext, initialOAuth: boolean) {
  const testRoot = mkdtempDisposableSync(join(tmpdir(), "pi-search-sdk-"));
  let dispose = () => {};
  t.after(() => { dispose(); testRoot.remove(); });
  const home = join(testRoot.path, "home");
  const cwd = join(testRoot.path, "project");
  const agentDir = join(home, ".pi", "agent");
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  function setNativeSearch(enabled: boolean) {
    writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ openai: { webSearch: enabled } }));
  }
  setNativeSearch(true);
  let oauth = initialOAuth;
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: null,
    modelsStorePath: join(agentDir, "models-cache.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  t.mock.method(modelRuntime, "isUsingOAuth", () => oauth);
  t.mock.method(modelRuntime, "hasConfiguredAuth", () => true);
  t.mock.method(modelRuntime, "getAuth", async () => ({ apiKey: "test-only-not-a-credential" }));
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    agentsFilesOverride: () => ({ agentsFiles: [] }),
    extensionFactories: [
      (pi) => websearch(pi, { home }),
      (pi) => openai(pi, { home }),
      (pi) => pi.registerTool({
        name: "switch_auth", label: "Switch", description: "Change test authentication", parameters: Type.Object({}),
        async execute() { oauth = !oauth; return { content: [], details: undefined }; },
      }),
    ],
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd, agentDir, resourceLoader, modelRuntime, settingsManager,
    sessionManager: SessionManager.inMemory(cwd), noTools: "builtin", thinkingLevel: "off",
    model: {
      provider: "openai", api: "openai-responses", id: "test-model", name: "Test",
      baseUrl: "https://api.openai.com/v1", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 10000, maxTokens: 1000,
    },
  });
  dispose = () => session.dispose();
  const errors: unknown[] = [];
  await session.bindExtensions({ onError: (error) => errors.push(error) });
  const payloads: any[] = [];
  session.agent.streamFunction = ((_model: any, context: any, options: any) => {
    const message = (async () => {
      // Consume Pi's actual transcript declarations, not its mutable live tool registry.
      const declarations = new Map<string, any>();
      for (const item of context.messages) {
        if (item.role !== "system") continue;
        for (const tool of item.toolsRemoved ?? []) declarations.delete(tool.name);
        for (const tool of item.toolsAdded ?? []) declarations.set(tool.name, tool);
      }
      const payload = { model: "test-model", tools: [...declarations.keys()].map((name) => ({ type: "function", name })) };
      payloads.push(await options.onPayload(payload, _model) ?? payload);
      const first = payloads.length === 1;
      return {
        role: "assistant", provider: "openai", api: "openai-responses", model: "test-model", timestamp: 1,
        content: first ? [{ type: "toolCall", id: "switch-1", name: "switch_auth", arguments: {} }] : [{ type: "text", text: "Done" }],
        stopReason: first ? "toolUse" : "stop",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
    })();
    return {
      async *[Symbol.asyncIterator]() {
        const result = await message;
        yield { type: "start", partial: result };
        yield { type: "done", reason: result.stopReason, message: result };
      },
      result: () => message,
    };
  }) as any;
  return { session, payloads, errors, setNativeSearch };
}

for (const initialOAuth of [false, true]) {
  test(`actual Pi turn snapshots keep search exclusive when OAuth changes from ${initialOAuth}`, async (t) => {
    const app = await setup(t, initialOAuth);
    await app.session.prompt("Switch authentication between two turns.");
    assert.deepEqual(app.errors, []);
    assert.equal(app.payloads.length, 2);
    for (let i = 0; i < 2; i++) {
      const native = i === 0 ? initialOAuth : !initialOAuth;
      assert.equal(app.payloads[i].tools.some((tool: any) => tool.type === "web_search"), native);
      assert.equal(app.payloads[i].tools.some((tool: any) => tool.type === "function" && tool.name === "websearch"), !native);
    }
  });
}

test("actual Pi reload does not reactivate user-disabled standalone search", async (t) => {
  const app = await setup(t, false);
  app.session.setActiveToolsByName(app.session.getActiveToolNames().filter((name) => name !== "websearch"));
  // The first turn changes OAuth to true, causing native search to withdraw the disabled tool.
  await app.session.prompt("Switch authentication.");
  assert.equal(app.session.getActiveToolNames().includes("websearch"), false);
  app.setNativeSearch(false);
  await app.session.reload();
  assert.deepEqual(app.errors, []);
  assert.equal(app.session.getToolDefinition("websearch")?.exposure, "direct");
  assert.equal(app.session.getActiveToolNames().includes("websearch"), false);
});
