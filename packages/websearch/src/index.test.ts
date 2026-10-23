import assert from "node:assert/strict";
import { mkdirSync, mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";

import openai from "../../openai/src/index";
import websearch from "./index";

type Handler = (event: any, ctx: any) => any;
type Order = "openai-first" | "websearch-first";

function setup(t: TestContext, order: Order = "openai-first", config?: unknown) {
  const testRoot = mkdtempDisposableSync(join(tmpdir(), "pi-search-exclusion-"));
  t.after(() => testRoot.remove());
  const home = join(testRoot.path, "home");
  const cwd = join(testRoot.path, "project");
  const handlers = new Map<string, Handler[]>();
  const tools = new Map<string, any>();
  const active = new Set(["read", "bash"]);
  const errors: unknown[] = [];
  const branch: any[] = [];
  let oauth = true;
  const ctx = {
    cwd,
    hasUI: false,
    model: { provider: "openai", api: "openai-responses", id: "test-model", baseUrl: "https://api.openai.com/v1" },
    modelRegistry: { isUsingOAuth: () => oauth },
    sessionManager: { getBranch: () => branch },
    isProjectTrusted: () => false,
  };
  const pi = {
    on(name: string, handler: Handler) {
      const list = handlers.get(name) ?? [];
      list.push(handler);
      handlers.set(name, list);
    },
    registerCommand() {},
    appendEntry(customType: string, data: unknown) { branch.push({ type: "custom", customType, data }); },
    registerTool(tool: any) {
      const previous = tools.get(tool.name);
      const previouslyDefaultActive = previous?.exposure !== "hidden" && previous?.defaultActive !== false;
      tools.set(tool.name, tool);
      if (tool.exposure === "hidden") active.delete(tool.name);
      else if ((!previous || !previouslyDefaultActive) && tool.defaultActive !== false) active.add(tool.name);
    },
    getActiveTools: () => [...active],
  };
  function writeConfig(value: unknown, scope: "global" | "project" = "project") {
    const path = scope === "global"
      ? join(home, ".pi", "agent", "pi-lab", "openai.json")
      : join(cwd, ".pi", "pi-lab", "openai.json");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(value));
  }
  if (config !== undefined) writeConfig(config);
  const options = { home, provider: "exa" as const, env: { EXA_API_KEY: "test-key" }, fetcher: (async () => {
    return new Response(JSON.stringify({ results: [{ title: "Example", url: "https://example.com/", text: "Result" }] }), { status: 200 });
  }) as typeof fetch };
  function load() {
    for (const extension of order === "openai-first" ? [openai, websearch] : [websearch, openai]) {
      extension(pi as any, options);
    }
  }
  load();
  async function emit(name: string, data: Record<string, unknown> = {}) {
    const event: any = { type: name, ...data };
    for (const handler of handlers.get(name) ?? []) {
      try {
        const result = await handler(event, ctx);
        if (name === "before_provider_request" && result !== undefined) event.payload = result;
      } catch (error) {
        // Pi reports lifecycle handler errors and continues dispatching other extensions.
        errors.push(error);
      }
    }
    return event;
  }
  return {
    ctx, tools, active, errors, writeConfig,
    setOAuth(value: boolean) { oauth = value; },
    start: () => emit("session_start"),
    async reload() {
      await emit("session_shutdown", { reason: "reload" });
      handlers.clear();
      tools.clear();
      active.delete("websearch");
      load();
      await emit("session_start", { reason: "reload" });
    },
    async request(newRun = true) {
      if (newRun) await emit("before_agent_start");
      else await emit("turn_end");
      // Pi captures the tool declaration snapshot before dispatching turn_start.
      const payload = { model: ctx.model.id, tools: [...active].map((name) => ({ type: "function", name })) };
      await emit("turn_start");
      return (await emit("before_provider_request", { payload })).payload;
    },
  };
}

function assertSearchChoice(payload: any, expected: "native" | "standalone") {
  const native = payload.tools.some((tool: any) => tool.type === "web_search");
  const standalone = payload.tools.some((tool: any) => tool.type === "function" && tool.name === "websearch");
  assert.equal(native, expected === "native");
  assert.equal(standalone, expected === "standalone");
  assert.deepEqual(payload.tools.filter((tool: any) => tool.type === "function" && tool.name !== "websearch"), [
    { type: "function", name: "read" },
    { type: "function", name: "bash" },
  ]);
}

for (const order of ["openai-first", "websearch-first"] as const) {
  test(`native search excludes standalone search regardless of load order: ${order}`, async (t) => {
    const app = setup(t, order, { openai: { webSearch: true } });
    await app.start();
    assertSearchChoice(await app.request(), "native");
    assert.equal(app.tools.has("websearch"), false);
    assert.deepEqual(app.errors, []);
  });

  test(`absent or disabled native config retains standalone search: ${order}`, async (t) => {
    const app = setup(t, order);
    await app.start();
    assertSearchChoice(await app.request(), "standalone");
    app.writeConfig({ openai: { webSearch: false } });
    await app.reload();
    assertSearchChoice(await app.request(), "standalone");
    assert.deepEqual(app.errors, []);
  });

  test(`reload switches search providers in both directions: ${order}`, async (t) => {
    const app = setup(t, order, { openai: { webSearch: false } });
    await app.start();
    assertSearchChoice(await app.request(), "standalone");
    app.writeConfig({ openai: { webSearch: true } });
    // Both extensions retain their session configuration until reload.
    assertSearchChoice(await app.request(), "standalone");
    await app.reload();
    assertSearchChoice(await app.request(), "native");
    assert.equal(app.tools.has("websearch"), false);
    app.writeConfig({ openai: { webSearch: false } });
    await app.reload();
    assertSearchChoice(await app.request(), "standalone");
    assert.equal(app.tools.get("websearch").exposure, "direct");
    assert.deepEqual(app.errors, []);
  });
}

for (const [name, model, oauth] of [
  ["another provider", { provider: "anthropic" }, true],
  ["Codex", { provider: "openai-codex" }, true],
  ["another API", { api: "openai-completions" }, true],
  ["a custom endpoint", { baseUrl: "https://proxy.example/v1" }, true],
  ["a lookalike endpoint", { baseUrl: "https://api.openai.com.evil.example/v1" }, true],
  ["API-key authentication", {}, false],
] as const) {
  test(`native search enabled in config does not suppress standalone search for ${name}`, async (t) => {
    const app = setup(t, "websearch-first", { openai: { webSearch: true } });
    Object.assign(app.ctx.model, model);
    app.setOAuth(oauth);
    await app.start();
    assertSearchChoice(await app.request(), "standalone");
    assert.deepEqual(app.errors, []);
  });
}

test("switching models between turns restores and withdraws standalone search", async (t) => {
  const app = setup(t, "websearch-first", { openai: { webSearch: true } });
  await app.start();
  assertSearchChoice(await app.request(), "native");
  app.ctx.model.provider = "anthropic";
  assertSearchChoice(await app.request(false), "standalone");
  app.ctx.model.provider = "openai";
  assertSearchChoice(await app.request(false), "native");
  assert.equal(app.tools.get("websearch").exposure, "hidden");
  app.ctx.model.provider = "anthropic";
  assertSearchChoice(await app.request(), "standalone");
  assert.deepEqual(app.errors, []);
});

test("authentication changes are checked again without rereading configuration", async (t) => {
  const app = setup(t, "websearch-first", { openai: { webSearch: true } });
  await app.start();
  assertSearchChoice(await app.request(), "native");
  app.setOAuth(false);
  assertSearchChoice(await app.request(), "standalone");
  app.setOAuth(true);
  assertSearchChoice(await app.request(), "native");
});

test("both extensions merge global and project settings identically", async (t) => {
  const app = setup(t, "websearch-first");
  app.writeConfig({ openai: { fast: true, webSearch: true } }, "global");
  app.writeConfig({ openai: { fast: false } });
  await app.start();
  assertSearchChoice(await app.request(), "native");
  app.writeConfig({ openai: { webSearch: false } });
  await app.reload();
  assertSearchChoice(await app.request(), "standalone");
});

test("invalid OpenAI config reports errors but keeps standalone search available", async (t) => {
  const app = setup(t, "websearch-first", { openai: { webSearch: true } });
  await app.start();
  assertSearchChoice(await app.request(), "native");
  app.writeConfig({ openai: { webSearch: true, fast: "yes" } });
  await app.reload();
  assertSearchChoice(await app.request(), "standalone");
  assert.ok(app.errors.length > 0);
});

test("restoring search does not activate a tool the user had disabled", async (t) => {
  const app = setup(t, "websearch-first", { openai: { webSearch: true } });
  app.ctx.model.provider = "anthropic";
  await app.start();
  app.active.delete("websearch");
  app.ctx.model.provider = "openai";
  assertSearchChoice(await app.request(), "native");
  app.ctx.model.provider = "anthropic";
  await app.request();
  assert.equal(app.tools.get("websearch").exposure, "direct");
  assert.equal(app.active.has("websearch"), false);
});

test("restored standalone search still executes using its configured provider", async (t) => {
  const app = setup(t, "websearch-first", { openai: { webSearch: true } });
  await app.start();
  await app.request();
  app.ctx.model.provider = "anthropic";
  await app.request();
  const result = await app.tools.get("websearch").execute("call-1", { query: "example" }, undefined, undefined, app.ctx);
  assert.equal(result.details.provider, "exa");
  assert.equal(result.details.resultCount, 1);
  assert.equal(result.details.results[0].url, "https://example.com/");
});
