import assert from "node:assert/strict";
import test from "node:test";

import { registerXSearchTool } from "./tool.js";

function captureTool() {
  let registered: any;
  const pi = {
    registerTool(tool: any) {
      registered = tool;
    },
  };
  return { pi, tool: () => registered };
}

test("registerXSearchTool registers intent-only parameters", () => {
  const { pi, tool } = captureTool();
  registerXSearchTool(pi as any, { env: { XAI_API_KEY: "key" }, settings: {} });

  const registered = tool();
  assert.equal(registered.name, "xsearch");
  const properties = registered.parameters.properties;
  assert.ok(properties.query);
  assert.ok(properties.allowed_x_handles);
  assert.ok(properties.excluded_x_handles);
  assert.ok(properties.from_date);
  assert.ok(properties.to_date);
  assert.ok(properties.count);
  assert.ok(properties.queryType);
  assert.equal(properties.model, undefined);
  assert.equal(properties.enable_image_understanding, undefined);
  assert.equal(properties.enable_video_understanding, undefined);
});

test("execute rejects with actionable guidance when no credentials exist", async () => {
  const { pi, tool } = captureTool();
  registerXSearchTool(pi as any, { env: {}, settings: {} });

  await assert.rejects(
    () => tool().execute("id", { query: "q" }, undefined, undefined, undefined),
    /set XAI_API_KEY .*or TWITTERAPI_IO_API_KEY/s,
  );
});

test("execute uses the xAI backend when XAI_API_KEY is present", async () => {
  const { pi, tool } = captureTool();
  const calls: string[] = [];
  const fetcher = (async (url: string | URL) => {
    calls.push(String(url));
    return new Response(
      JSON.stringify({
        output: [{ content: [{ text: "xAI answer", annotations: [{ url: "https://x.com/a/status/1" }] }] }],
        usage: { server_side_tool_usage_details: { x_search_calls: 1 } },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  registerXSearchTool(pi as any, { env: { XAI_API_KEY: "key" }, fetcher, settings: {} });
  const result = await tool().execute("id", { query: "q" }, undefined, undefined, undefined);

  assert.equal(calls[0], "https://api.x.ai/v1/responses");
  assert.match(result.content[0].text, /## Answer\n\nxAI answer/);
  assert.match(result.content[0].text, /1\. https:\/\/x\.com\/a\/status\/1/);
});

test("execute retrieves through twitterapi.io and synthesizes when only that key exists", async () => {
  const { pi, tool } = captureTool();
  const seen: string[] = [];
  const fetcher = (async (url: string | URL) => {
    const href = String(url);
    seen.push(href);
    return new Response(
      JSON.stringify({
        tweets: [
          {
            id: "1",
            url: "https://x.com/alice/status/111",
            text: "post body",
            createdAt: "Mon Sep 21 10:00:00 +0000 2026",
            author: { userName: "alice", name: "Alice" },
          },
        ],
        has_next_page: false,
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const registry = {
    find: () => undefined,
    getAll: () => [{ provider: "anthropic", id: "haiku", input: ["text"] }],
    complete: async () => ({ content: [{ type: "text", text: "Synthesized (https://x.com/alice/status/111)." }] }),
  };

  registerXSearchTool(pi as any, {
    env: { TWITTERAPI_IO_API_KEY: "key" },
    fetcher,
    settings: { xsearch: { synthesisModel: "anthropic/haiku" } },
  });
  const result = await tool().execute("id", { query: "q" }, undefined, undefined, { modelRegistry: registry });

  assert.match(seen[0], /api\.twitterapi\.io/);
  assert.match(result.content[0].text, /Model: anthropic\/haiku/);
  assert.match(result.content[0].text, /## Answer\n\nSynthesized/);
  assert.match(result.content[0].text, /1\. https:\/\/x\.com\/alice\/status\/111/);
});

test("execute explains a missing synthesis model instead of failing obscurely", async () => {
  const { pi, tool } = captureTool();
  const fetcher = (async () => new Response(JSON.stringify({ tweets: [], has_next_page: false }), { status: 200 })) as unknown as typeof fetch;
  const registry = { find: () => undefined, getAll: () => [], complete: async () => ({}) };

  registerXSearchTool(pi as any, {
    env: { TWITTERAPI_IO_API_KEY: "key" },
    fetcher,
    settings: { xsearch: { synthesisModel: "anthropic/missing" } },
  });

  await assert.rejects(
    () => tool().execute("id", { query: "q" }, undefined, undefined, { modelRegistry: registry }),
    /was not found in pi's model catalogue/,
  );
});

test("execute reports when pi's model registry is unavailable", async () => {
  const { pi, tool } = captureTool();
  const fetcher = (async () => new Response(JSON.stringify({ tweets: [], has_next_page: false }), { status: 200 })) as unknown as typeof fetch;

  registerXSearchTool(pi as any, { env: { TWITTERAPI_IO_API_KEY: "key" }, fetcher, settings: {} });

  await assert.rejects(
    () => tool().execute("id", { query: "q" }, undefined, undefined, undefined),
    /model registry/,
  );
});

test("execute reports that pi's ModelRegistry.complete is required, and does no network work first", async () => {
  const { pi, tool } = captureTool();
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ tweets: [], has_next_page: false }), { status: 200 });
  }) as unknown as typeof fetch;
  // A registry shaped like pi 0.80.6: find/getAll exist, complete does not.
  const legacyRegistry = {
    find: () => undefined,
    getAll: () => [{ provider: "anthropic", id: "haiku", input: ["text"] }],
  };

  registerXSearchTool(pi as any, {
    env: { TWITTERAPI_IO_API_KEY: "key" },
    fetcher,
    settings: { xsearch: { synthesisModel: "anthropic/haiku" } },
  });

  await assert.rejects(
    () => tool().execute("id", { query: "q" }, undefined, undefined, { modelRegistry: legacyRegistry }),
    /needs pi's ModelRegistry\.complete[\s\S]*0\.80\.6[\s\S]*XAI_API_KEY/,
  );
  assert.equal(calls, 0, "compatibility must be checked before any retrieval");
});

test("execute requires synthesisModel and does not silently reuse the xAI model key", async () => {
  const { pi, tool } = captureTool();
  const fetcher = (async () => new Response(JSON.stringify({ tweets: [], has_next_page: false }), { status: 200 })) as unknown as typeof fetch;
  const registry = {
    find: () => undefined,
    getAll: () => [{ provider: "anthropic", id: "haiku", input: ["text"] }],
    complete: async () => ({ content: [{ type: "text", text: "unused" }] }),
  };

  registerXSearchTool(pi as any, {
    env: { TWITTERAPI_IO_API_KEY: "key" },
    fetcher,
    // Only the xAI model key is set: the synthesis model must NOT be inferred from it.
    settings: { xsearch: { model: "grok-4-1-fast-non-reasoning" } },
  });

  await assert.rejects(
    () => tool().execute("id", { query: "q" }, undefined, undefined, { modelRegistry: registry }),
    /needs a synthesis model[\s\S]*xsearch\.model is reserved for the xAI backend/,
  );
});

test("execute surfaces a failed synthesis instead of returning an empty answer", async () => {
  const { pi, tool } = captureTool();
  const fetcher = (async () =>
    new Response(
      JSON.stringify({
        tweets: [
          {
            id: "1",
            url: "https://x.com/alice/status/111",
            text: "post body",
            createdAt: "Mon Sep 21 10:00:00 +0000 2026",
            author: { userName: "alice", name: "Alice" },
          },
        ],
        has_next_page: false,
      }),
      { status: 200 },
    )) as unknown as typeof fetch;

  // A provider failure resolves as an assistant message with stopReason "error".
  const registry = {
    find: () => undefined,
    getAll: () => [{ provider: "anthropic", id: "haiku", input: ["text"] }],
    complete: async () => ({ stopReason: "error", errorMessage: "provider overloaded", content: [] }),
  };

  registerXSearchTool(pi as any, {
    env: { TWITTERAPI_IO_API_KEY: "key" },
    fetcher,
    settings: { xsearch: { synthesisModel: "anthropic/haiku" } },
  });

  await assert.rejects(
    () => tool().execute("id", { query: "q" }, undefined, undefined, { modelRegistry: registry }),
    /xsearch synthesis failed: provider overloaded/,
  );
});

function userRegistry(text: string) {
  return {
    find: () => undefined,
    getAll: () => [{ provider: "anthropic", id: "haiku", input: ["text"] }],
    complete: async () => ({ content: [{ type: "text", text }] }),
  };
}

test("execute dispatches mode=users to account search and cites profile URLs", async () => {
  const { pi, tool } = captureTool();
  const seen: string[] = [];
  const fetcher = (async (url: string | URL) => {
    seen.push(String(url));
    return new Response(
      JSON.stringify({
        users: [
          { id: "1", screen_name: "grok", name: "Grok", description: "bio", followers_count: 100, isBlueVerified: true, url: "https://t.co/x" },
        ],
        has_next_page: false,
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  registerXSearchTool(pi as any, {
    env: { TWITTERAPI_IO_API_KEY: "key" },
    fetcher,
    settings: { xsearch: { synthesisModel: "anthropic/haiku" } },
  });

  const result = await tool().execute("id", { query: "grok", mode: "users" }, undefined, undefined, {
    modelRegistry: userRegistry("Built by (https://x.com/grok)."),
  });

  assert.match(seen[0], /\/twitter\/user\/search/, "the account endpoint is used");
  assert.ok(!/advanced_search/.test(seen[0]), "the post endpoint is not used for a user search");
  assert.match(result.content[0].text, /1\. https:\/\/x\.com\/grok/, "sources are constructed profile URLs");
});

test("execute dispatches mode=thread and requires a tweet reference", async () => {
  const { pi, tool } = captureTool();
  const fetcher = (async (url: string | URL) => {
    assert.match(String(url), /thread_context/);
    return new Response(
      JSON.stringify({
        status: "success",
        tweets: [{ id: "7", url: "https://x.com/a/status/7", text: "root", createdAt: "Thu Oct 01 12:00:00 +0000 2026", author: { userName: "a" } }],
        has_next_page: false,
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  registerXSearchTool(pi as any, {
    env: { TWITTERAPI_IO_API_KEY: "key" },
    fetcher,
    settings: { xsearch: { synthesisModel: "anthropic/haiku" } },
  });

  await assert.rejects(
    () => tool().execute("id", { query: "thread", mode: "thread" }, undefined, undefined, { modelRegistry: userRegistry("x") }),
    /needs a tweet/,
  );

  const result = await tool().execute("id", { query: "thread", mode: "thread", tweet: "7" }, undefined, undefined, {
    modelRegistry: userRegistry("Root post (https://x.com/a/status/7)."),
  });
  assert.match(result.content[0].text, /1\. https:\/\/x\.com\/a\/status\/7/);
});

test("execute rejects an unknown mode before doing any work", async () => {
  const { pi, tool } = captureTool();
  const fetcher = (async () => {
    throw new Error("no request may be made for an invalid mode");
  }) as unknown as typeof fetch;
  registerXSearchTool(pi as any, {
    env: { TWITTERAPI_IO_API_KEY: "key" },
    fetcher,
    settings: { xsearch: { synthesisModel: "anthropic/haiku" } },
  });
  await assert.rejects(
    () => tool().execute("id", { query: "x", mode: "nonsense" }, undefined, undefined, { modelRegistry: userRegistry("x") }),
    /mode must be "posts", "users", or "thread"/,
  );
});

test("mode=thread answers the user's question, not the tweet reference", async () => {
  const { pi, tool } = captureTool();
  let seenPrompt = "";
  const fetcher = (async () =>
    new Response(
      JSON.stringify({
        status: "success",
        tweets: [{ id: "7", url: "https://x.com/a/status/7", text: "our deadline is Friday", createdAt: "Thu Oct 01 12:00:00 +0000 2026", author: { userName: "a" } }],
        has_next_page: false,
      }),
      { status: 200 },
    )) as unknown as typeof fetch;

  registerXSearchTool(pi as any, {
    env: { TWITTERAPI_IO_API_KEY: "key" },
    fetcher,
    settings: { xsearch: { synthesisModel: "anthropic/haiku" } },
  });

  const registry = {
    find: () => undefined,
    getAll: () => [{ provider: "anthropic", id: "haiku", input: ["text"] }],
    complete: async (_model: unknown, context: { messages: Array<{ content: unknown }> }) => {
      seenPrompt = String(context.messages[0].content);
      return { content: [{ type: "text", text: "Friday (https://x.com/a/status/7)." }] };
    },
  };

  const result = await tool().execute(
    "id",
    { query: "what deadline is announced?", mode: "thread", tweet: "7" },
    undefined,
    undefined,
    { modelRegistry: registry },
  );

  assert.match(seenPrompt, /what deadline is announced\?/, "the question reaches the synthesis prompt");
  assert.ok(!/^Question: 7$/m.test(seenPrompt), "the tweet reference must not replace the question");
  assert.match(result.content[0].text, /^Query: what deadline is announced\?/m, "the answer is labelled with the question");
  assert.match(result.content[0].text, /thread context of post 7/, "the thread is identified in Notes");
});

test("mode=users rejects parameters it cannot apply", async () => {
  const { pi, tool } = captureTool();
  const fetcher = (async () => {
    throw new Error("no request may be made for an unsupported combination");
  }) as unknown as typeof fetch;
  registerXSearchTool(pi as any, {
    env: { TWITTERAPI_IO_API_KEY: "key" },
    fetcher,
    settings: { xsearch: { synthesisModel: "anthropic/haiku" } },
  });

  await assert.rejects(
    () => tool().execute("id", { query: "grok", mode: "users", excluded_x_handles: ["spam"] }, undefined, undefined, { modelRegistry: userRegistry("x") }),
    /excluded_x_handles cannot be applied in mode "users"/,
  );
  await assert.rejects(
    () => tool().execute("id", { query: "grok", mode: "users", from_date: "2026-09-01" }, undefined, undefined, { modelRegistry: userRegistry("x") }),
    /from_date cannot be applied in mode "users"/,
  );
  await assert.rejects(
    () => tool().execute("id", { query: "q", mode: "thread", tweet: "7", queryType: "Top" }, undefined, undefined, { modelRegistry: userRegistry("x") }),
    /queryType cannot be applied in mode "thread"/,
  );
});

test("configured page limits bound the new modes", async () => {
  const { pi, tool } = captureTool();
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return new Response(
      JSON.stringify({ users: [{ id: String(calls), screen_name: `h${calls}` }], has_next_page: true, next_cursor: `c${calls}` }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  registerXSearchTool(pi as any, {
    env: { TWITTERAPI_IO_API_KEY: "key" },
    fetcher,
    settings: { xsearch: { synthesisModel: "anthropic/haiku", maxPages: 1, maxPagesCeiling: 1 } },
  });

  await tool().execute("id", { query: "grok", mode: "users" }, undefined, undefined, {
    modelRegistry: userRegistry("None (https://x.com/h1)."),
  });
  assert.equal(calls, 1, "maxPagesCeiling of 1 must bound an account search");
});

test("a multi-word account query that finds nothing explains why", async () => {
  const { pi, tool } = captureTool();
  const fetcher = (async () => new Response(JSON.stringify({ users: [], has_next_page: false }), { status: 200 })) as unknown as typeof fetch;
  registerXSearchTool(pi as any, {
    env: { TWITTERAPI_IO_API_KEY: "key" },
    fetcher,
    settings: { xsearch: { synthesisModel: "anthropic/haiku" } },
  });

  const result = await tool().execute("id", { query: "pi coding agent", mode: "users" }, undefined, undefined, {
    modelRegistry: userRegistry("unused"),
  });
  assert.match(result.content[0].text, /no word boundaries/, "the query shape is explained");
  assert.match(result.content[0].text, /No accounts matched/, "and the empty result is honest");
});

test("mode=thread tells the xAI backend which thread to read", async () => {
  const { pi, tool } = captureTool();
  let body = "";
  const fetcher = (async (_url: string | URL, init?: RequestInit) => {
    body = String(init?.body ?? "");
    return new Response(
      JSON.stringify({ output: [{ content: [{ text: "Answer (https://x.com/a/status/7)" }] }], usage: {} }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  registerXSearchTool(pi as any, { env: { XAI_API_KEY: "key" }, fetcher, settings: {} });
  const result = await tool().execute(
    "id",
    { query: "what deadline is announced?", mode: "thread", tweet: "https://x.com/a/status/7" },
    undefined,
    undefined,
    undefined,
  );

  assert.match(body, /what deadline is announced\?/, "the question is sent");
  assert.match(body, /https:\/\/x\.com\/i\/status\/7/, "the thread reference is sent too, or xAI cannot find it");
  assert.match(result.content[0].text, /## Answer/);
});

test("mode and tweet are validated before credentials", async () => {
  const { pi, tool } = captureTool();
  registerXSearchTool(pi as any, { env: {}, settings: {} });

  await assert.rejects(
    () => tool().execute("id", { query: "x", mode: "nonsense" }, undefined, undefined, undefined),
    /mode must be "posts", "users", or "thread"/,
  );
  await assert.rejects(
    () => tool().execute("id", { query: "x", tweet: "7" }, undefined, undefined, undefined),
    /tweet can only be used in mode "thread"/,
  );
  await assert.rejects(
    () => tool().execute("id", { query: "x", mode: "thread", tweet: "not-a-tweet" }, undefined, undefined, undefined),
    /must be a numeric post id or an X permalink/,
  );
});

test("a blank thread question is rejected before retrieval", async () => {
  const { pi, tool } = captureTool();
  const fetcher = (async () => {
    throw new Error("no request may be made for a blank question");
  }) as unknown as typeof fetch;
  registerXSearchTool(pi as any, {
    env: { TWITTERAPI_IO_API_KEY: "key" },
    fetcher,
    settings: { xsearch: { synthesisModel: "anthropic/haiku" } },
  });
  await assert.rejects(
    () => tool().execute("id", { query: "   ", mode: "thread", tweet: "7" }, undefined, undefined, { modelRegistry: userRegistry("x") }),
    /query must not be empty/,
  );
});

test("a configured page budget above the endpoint default still works", async () => {
  const { pi, tool } = captureTool();
  const fetcher = (async () =>
    new Response(JSON.stringify({ users: [{ id: "1", screen_name: "h1" }], has_next_page: false }), { status: 200 })) as unknown as typeof fetch;
  registerXSearchTool(pi as any, {
    env: { TWITTERAPI_IO_API_KEY: "key" },
    fetcher,
    settings: { xsearch: { synthesisModel: "anthropic/haiku", maxPages: 21, maxPagesCeiling: 21 } },
  });
  const result = await tool().execute("id", { query: "grok", mode: "users" }, undefined, undefined, {
    modelRegistry: userRegistry("A (https://x.com/h1)."),
  });
  assert.match(result.content[0].text, /## Sources/, "a valid config must not be rejected as an invalid bound");
});

test("a blank question is rejected on the xAI path before the reference is added", async () => {
  // Appending "Thread: <url>" used to turn a blank question into a non-empty
  // one, so xAI sent it while the twitterapi.io path rejected it.
  const { pi, tool } = captureTool();
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ output: [{ content: [{ text: "x" }] }], usage: {} }), { status: 200 });
  }) as unknown as typeof fetch;
  registerXSearchTool(pi as any, { env: { XAI_API_KEY: "key" }, fetcher, settings: {} });

  await assert.rejects(
    () => tool().execute("id", { query: "   ", mode: "thread", tweet: "7" }, undefined, undefined, undefined),
    /query must not be empty/,
  );
  await assert.rejects(() => tool().execute("id", { query: "  " }, undefined, undefined, undefined), /query must not be empty/);
  assert.equal(calls, 0, "no request may be made for a blank question");
});

test("a thread question reaches xAI trimmed, with the reference after it", async () => {
  const { pi, tool } = captureTool();
  let body = "";
  const fetcher = (async (_url: string | URL, init?: RequestInit) => {
    body = String(init?.body ?? "");
    return new Response(JSON.stringify({ output: [{ content: [{ text: "x" }] }], usage: {} }), { status: 200 });
  }) as unknown as typeof fetch;
  registerXSearchTool(pi as any, { env: { XAI_API_KEY: "key" }, fetcher, settings: {} });

  const inputOf = (raw: string): string => {
    const parsed = JSON.parse(raw) as { input: { role: string; content: string }[] };
    return parsed.input[0].content;
  };

  await tool().execute("id", { query: "  what deadline?  ", mode: "thread", tweet: "7" }, undefined, undefined, undefined);
  assert.equal(inputOf(body), "what deadline?\n\nThread: https://x.com/i/status/7");

  // A permalink with a path is canonicalised, so the reference is stable whatever the caller passed.
  await tool().execute(
    "id",
    { query: "what deadline?", mode: "thread", tweet: "https://x.com/a/status/7/photo/1" },
    undefined,
    undefined,
    undefined,
  );
  assert.equal(inputOf(body), "what deadline?\n\nThread: https://x.com/i/status/7");
});

test("the xAI backend forwards handle filters and dates without the twitterapi.io mode rejection", async () => {
  // The README scopes per-mode rejection to the twitterapi.io backend; this pins that.
  const { pi, tool } = captureTool();
  let body = "";
  const fetcher = (async (_url: string | URL, init?: RequestInit) => {
    body = String(init?.body ?? "");
    return new Response(JSON.stringify({ output: [{ content: [{ text: "x" }] }], usage: {} }), { status: 200 });
  }) as unknown as typeof fetch;
  registerXSearchTool(pi as any, { env: { XAI_API_KEY: "key" }, fetcher, settings: {} });

  await tool().execute(
    "id",
    { query: "q", mode: "users", allowed_x_handles: ["alice"], from_date: "2026-10-01", count: 10, queryType: "Top" },
    undefined,
    undefined,
    undefined,
  );
  const tool0 = (JSON.parse(body) as { tools: { allowed_x_handles?: string[]; from_date?: string }[] }).tools[0];
  assert.deepEqual(tool0.allowed_x_handles, ["alice"], "handle filters reach xAI");
  assert.equal(tool0.from_date, "2026-10-01", "dates reach xAI");
  assert.ok(!("count" in tool0) && !("queryType" in tool0), "count/queryType are not part of the xAI request");

  // The twitterapi.io backend still rejects the same call loudly.
  const twitterApi = async (): Promise<Response> => {
    throw new Error("no request may be made");
  };
  registerXSearchTool(pi as any, {
    env: { TWITTERAPI_IO_API_KEY: "key" },
    fetcher: twitterApi as unknown as typeof fetch,
    settings: { xsearch: { synthesisModel: "anthropic/haiku" } },
  });
  await assert.rejects(
    () =>
      tool().execute(
        "id",
        { query: "q", mode: "users", allowed_x_handles: ["alice"] },
        undefined,
        undefined,
        { modelRegistry: userRegistry("x") },
      ),
    /allowed_x_handles cannot be applied in mode "users"/,
  );
});
