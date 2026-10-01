import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  DEFAULT_MAX_PAGES_CEILING,
  MAX_RETRY_DELAY_MS,
  fetchThread,
  searchUsers,
  statusIdFromUrl,
  tweetIdFromInput,
  buildExpression,
  normalizeParams,
  parseRetryAfter,
  parseTweetDate,
  resolveLocalWindow,
  searchTweets,
  upstreamEndMs,
  isRetryableStatus,
  upstreamStartDateString,
  type FetchLike,
} from "./twitterapi.js";

const MX = -360; // UTC-6 (America/Mexico_City)

function jsonResponse(body: unknown, init: { status?: number; retryAfter?: string } = {}) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? init.retryAfter ?? null : null) },
    json: async () => body,
  } as unknown as Response;
}

function tweet(overrides: Record<string, unknown> = {}) {
  return {
    id: "1",
    url: "https://x.com/a/status/1",
    text: "hello",
    createdAt: "Sun Sep 20 12:00:00 +0000 2026",
    author: { userName: "a", name: "A" },
    ...overrides,
  };
}

const noSleep = () => Promise.resolve();

// ---------------------------------------------------------------- validation

test("rejects empty query, bad dates, bad handles, bad counts", () => {
  assert.throws(() => normalizeParams({ query: "  " }), /query must not be empty/);
  assert.throws(() => normalizeParams({ query: "x", from_date: "2026-9-1" }), /YYYY-MM-DD/);
  assert.throws(() => normalizeParams({ query: "x", from_date: "2026-99-99" }), /not a real calendar date/);
  assert.throws(() => normalizeParams({ query: "x", from_date: "2025-02-29" }), /not a real calendar date/);
  assert.throws(() => normalizeParams({ query: "x", allowed_x_handles: ["a b"] }), /valid X handles/);
  // xAI documents a limit of 20, so 20 must be accepted and 21 rejected.
  assert.doesNotThrow(() => normalizeParams({ query: "x", allowed_x_handles: Array.from({ length: 20 }, (_, i) => `h${i}`) }));
  assert.throws(() => normalizeParams({ query: "x", allowed_x_handles: Array.from({ length: 21 }, (_, i) => `h${i}`) }), /at most 20/);
  assert.throws(() => normalizeParams({ query: "x", count: 51 }), /between 1 and 50/);
  assert.throws(
    () => normalizeParams({ query: "x", allowed_x_handles: ["a"], excluded_x_handles: ["b"] }),
    /cannot be set together/,
  );
  assert.equal(normalizeParams({ query: "x", from_date: "2024-02-29" }).from_date, "2024-02-29");
});

// ------------------------------------------------------------------ grouping

test("groups the user query so OR branches cannot leak past constraints", () => {
  assert.equal(buildExpression(normalizeParams({ query: "cats OR dogs" })), "cats OR dogs");
  assert.equal(
    buildExpression(normalizeParams({ query: "cats OR dogs", allowed_x_handles: ["alice"] })),
    "(cats OR dogs) from:alice",
  );
  assert.equal(
    buildExpression(normalizeParams({ query: "q", allowed_x_handles: ["a", "b"], excluded_x_handles: undefined, from_date: "2026-09-01" })),
    "(q) (from:a OR from:b) since:2026-09-01",
  );
});

// ------------------------------------------------------------------- retries

test("retries 429 then succeeds", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const fetcher: FetchLike = async () => {
    calls += 1;
    return calls === 1
      ? jsonResponse({ detail: "rate limited" }, { status: 429 })
      : jsonResponse({ tweets: [tweet()], has_next_page: false });
  };
  const details = await searchTweets(normalizeParams({ query: "x", count: 1 }), "k", fetcher, {
    sleep: async (ms) => { sleeps.push(ms); },
  });
  assert.equal(calls, 2);
  assert.equal(details.tweets.length, 1);
  assert.equal(sleeps.length, 1);
});

test("honors numeric Retry-After, floors a zero delay, and refuses an over-cap delay", async () => {
  assert.equal(parseRetryAfter("2"), 2000);
  assert.equal(parseRetryAfter("0"), 0);
  assert.equal(parseRetryAfter("nonsense"), undefined);
  assert.equal(parseRetryAfter(null), undefined);

  const now = Date.parse("2026-10-01T00:00:00Z");
  assert.equal(parseRetryAfter("Thu, 01 Oct 2026 00:00:30 GMT", now), 30_000);
  assert.equal(parseRetryAfter("Thu, 01 Oct 2026 00:00:00 GMT", now), 0); // expired -> no wait
  assert.equal(parseRetryAfter("Thu, 01 Oct 2026 00:00:00 GMT", now + 5_000), 0);

  const sleeps: number[] = [];
  let calls = 0;
  const fetcher: FetchLike = async () => {
    calls += 1;
    return calls === 1
      ? jsonResponse({}, { status: 429, retryAfter: "2" })
      : jsonResponse({ tweets: [tweet()], has_next_page: false });
  };
  await searchTweets(normalizeParams({ query: "x", count: 1 }), "k", fetcher, {
    sleep: async (ms) => { sleeps.push(ms); },
    retryBaseDelayMs: 1_000,
    minRequestIntervalMs: 0,
  });
  assert.deepEqual(sleeps, [2000], "a server delay above the base must not be shortened to it");
  assert.equal(calls, 2);

  // `Retry-After: 0` must not degenerate into a hot loop.
  const zeroSleeps: number[] = [];
  let zeroCalls = 0;
  const zeroFetcher: FetchLike = async () => {
    zeroCalls += 1;
    return zeroCalls === 1
      ? jsonResponse({}, { status: 429, retryAfter: "0" })
      : jsonResponse({ tweets: [tweet()], has_next_page: false });
  };
  await searchTweets(normalizeParams({ query: "x", count: 1 }), "k", zeroFetcher, {
    sleep: async (ms) => { zeroSleeps.push(ms); },
    retryBaseDelayMs: 1_500,
    minRequestIntervalMs: 0,
  });
  assert.deepEqual(zeroSleeps, [1_500], "a zero delay falls back to the backoff floor");

  // A delay beyond the cap stops the retry instead of firing early.
  let overCapCalls = 0;
  const overCap: FetchLike = async () => {
    overCapCalls += 1;
    return jsonResponse({}, { status: 429, retryAfter: "3600" });
  };
  await assert.rejects(
    searchTweets(normalizeParams({ query: "x", count: 1 }), "k", overCap, {
      sleep: noSleep,
      retryBaseDelayMs: 1_000,
      minRequestIntervalMs: 0,
    }),
    /beyond the 60s cap; not retrying/,
  );
  assert.equal(overCapCalls, 1, "an over-cap delay must not trigger another request");
});

test("does not retry non-retryable 4xx", async () => {
  let calls = 0;
  const fetcher: FetchLike = async () => {
    calls += 1;
    return jsonResponse({ detail: "bad key" }, { status: 401 });
  };
  await assert.rejects(
    searchTweets(normalizeParams({ query: "x", count: 1 }), "k", fetcher, { sleep: noSleep }),
    /bad key/,
  );
  assert.equal(calls, 1);
});

test("retries transient transport errors, surfaces exhaustion", async () => {
  let calls = 0;
  const flaky: FetchLike = async () => {
    calls += 1;
    if (calls < 3) throw new Error("fetch failed");
    return jsonResponse({ tweets: [tweet()], has_next_page: false });
  };
  await searchTweets(normalizeParams({ query: "x", count: 1 }), "k", flaky, { sleep: noSleep });
  assert.equal(calls, 3);

  let always = 0;
  const alwaysFails: FetchLike = async () => { always += 1; throw new Error("fetch failed"); };
  await assert.rejects(
    searchTweets(normalizeParams({ query: "x", count: 1 }), "k", alwaysFails, { maxRetries: 2, sleep: noSleep }),
    /fetch failed/,
  );
  assert.equal(always, 3); // initial + 2 retries
});

test("an unreadable body on a successful status is not retried, and reports why", async () => {
  let bodyFails = 0;
  const stallingBody: FetchLike = async () => {
    bodyFails += 1;
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new Error("socket hang up"); } } as unknown as Response;
  };
  await assert.rejects(
    searchTweets(normalizeParams({ query: "x", count: 1 }), "k", stallingBody, { sleep: noSleep, minRequestIntervalMs: 0 }),
    /may already have been billed/,
  );
  assert.equal(bodyFails, 1, "a page that may already be billed must not be requested again");

  // A JSON syntax error on a successful status is a malformed payload, and the
  // status is still reported even though there is no usable body.
  const badJson: FetchLike = async () =>
    ({ ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new SyntaxError("Unexpected token"); } } as unknown as Response);
  await assert.rejects(
    searchTweets(normalizeParams({ query: "x", count: 1 }), "k", badJson, { sleep: noSleep, minRequestIntervalMs: 0 }),
    /malformed response \(HTTP 200\)/,
  );
});

test("maxRetries 0 means exactly one attempt", async () => {
  let calls = 0;
  const fetcher: FetchLike = async () => { calls += 1; return jsonResponse({}, { status: 429 }); };
  await assert.rejects(
    searchTweets(normalizeParams({ query: "x", count: 1 }), "k", fetcher, { maxRetries: 0, sleep: noSleep }),
    /429/,
  );
  assert.equal(calls, 1);
});

test("rejects an invalid timeout", async () => {
  const fetcher: FetchLike = async () => jsonResponse({ tweets: [], has_next_page: false });
  await assert.rejects(
    searchTweets(normalizeParams({ query: "x" }), "k", fetcher, { timeoutMs: 0 }),
    /timeoutMs must be a positive number/,
  );
});

// ---------------------------------------------------------------- cancellation

test("aborting the tool signal cancels requests and backoff", async () => {
  const controller = new AbortController();
  let calls = 0;
  const fetcher: FetchLike = async () => {
    calls += 1;
    controller.abort();
    return jsonResponse({}, { status: 429 });
  };
  await assert.rejects(
    searchTweets(normalizeParams({ query: "x", count: 1 }), "k", fetcher, {
      signal: controller.signal,
      sleep: noSleep,
    }),
    /cancelled/,
  );
  assert.equal(calls, 1);

  const preAborted = new AbortController();
  preAborted.abort();
  let neverCalled = 0;
  await assert.rejects(
    searchTweets(normalizeParams({ query: "x", count: 1 }), "k", async () => { neverCalled += 1; return jsonResponse({}); }, {
      signal: preAborted.signal,
      sleep: noSleep,
    }),
    /cancelled/,
  );
  assert.equal(neverCalled, 0);
});

// -------------------------------------------------------- timezone / windows

test("upstream boundary helpers match the measured 04:00 UTC day boundary", () => {
  assert.equal(upstreamEndMs("2026-09-25"), Date.UTC(2026, 8, 26, 4, 0, 0));
  // to_date + 1 across month rollover
  assert.equal(upstreamEndMs("2026-09-30"), Date.UTC(2026, 9, 1, 4, 0, 0));
  // offset -6 -> 2h tail gap (derived from the resolved window, not a helper)
  assert.equal(
    (resolveLocalWindow(normalizeParams({ query: "x", to_date: "2026-09-21" }), MX)?.shortfallHours),
    2,
  );
  assert.equal(
    (resolveLocalWindow(normalizeParams({ query: "x", to_date: "2026-09-21" }), -240)?.shortfallHours),
    0,
  );
  assert.equal(
    (resolveLocalWindow(normalizeParams({ query: "x", to_date: "2026-09-21" }), 120)?.shortfallHours),
    0,
  );
  // start date is the latest 04:00 UTC boundary at or before the window start
  assert.equal(upstreamStartDateString(Date.UTC(2026, 8, 21, 6, 0, 0)), "2026-09-21");
  assert.equal(upstreamStartDateString(Date.UTC(2026, 8, 21, 3, 0, 0)), "2026-09-20");
});

test("fixed-offset window: one-sided filters stay one-sided", () => {
  const fromOnly = resolveLocalWindow(normalizeParams({ query: "x", from_date: "2026-09-21" }), MX);
  assert.equal(fromOnly?.startMs, Date.UTC(2026, 8, 21, 6, 0, 0));
  assert.equal(fromOnly?.endMs, Number.POSITIVE_INFINITY);
  assert.equal(fromOnly?.shortfallHours, 0);
  assert.equal(fromOnly?.fromDate, "2026-09-21");
  assert.equal(fromOnly?.toDate, undefined);

  const toOnly = resolveLocalWindow(normalizeParams({ query: "x", to_date: "2026-09-21" }), MX);
  assert.equal(toOnly?.startMs, Number.NEGATIVE_INFINITY);
  assert.equal(toOnly?.endMs, Date.UTC(2026, 8, 22, 6, 0, 0));
  assert.equal(toOnly?.shortfallHours, 2);

  const both = resolveLocalWindow(normalizeParams({ query: "x", from_date: "2026-09-21", to_date: "2026-09-21" }), MX);
  assert.equal(both?.startMs, Date.UTC(2026, 8, 21, 6, 0, 0));
  assert.equal(both?.endMs, Date.UTC(2026, 8, 22, 6, 0, 0));

  assert.equal(resolveLocalWindow(normalizeParams({ query: "x" }), MX), undefined);
});

test("host-zone midnight stays correct across DST transitions (deterministic, child process)", () => {
  // Node latches TZ per process, so each zone/date runs in its own child.
  const moduleUrl = new URL("./twitterapi.ts", import.meta.url).href;
  const midnight = (tz: string, date: string): string => {
    const script = `
      import { resolveLocalWindow } from ${JSON.stringify(moduleUrl)};
      const w = resolveLocalWindow({ query: 'x', from_date: ${JSON.stringify(date)} });
      process.stdout.write(new Date(w.startMs).toISOString());
    `;
    return execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, TZ: tz },
      encoding: "utf8",
    }).trim();
  };

  // Sao Paulo 2018-11-04: midnight never happens (clocks jump 00:00 -> 01:00),
  // so the day begins the moment the clock passes into it: 03:00Z.
  assert.equal(midnight("America/Sao_Paulo", "2018-11-04"), "2018-11-04T03:00:00.000Z");
  // Sao Paulo 2018-02-18: midnight repeats; the day begins at the first instant
  // that actually reads as Feb 18 (the pre-shift reading 02:00Z is still Feb 17).
  assert.equal(midnight("America/Sao_Paulo", "2018-02-18"), "2018-02-18T03:00:00.000Z");
  // Australia/Sydney switches at 02:00 local, not midnight. A single offset probe
  // taken a fixed distance before the boundary lands after the switch and returns
  // the previous local day; both directions are pinned here.
  assert.equal(midnight("Australia/Sydney", "2026-10-04"), "2026-10-03T14:00:00.000Z");
  assert.equal(midnight("Australia/Sydney", "2026-04-05"), "2026-04-04T13:00:00.000Z");
  // America/New_York transitions on the same 02:00 local schedule.
  assert.equal(midnight("America/New_York", "2026-03-08"), "2026-03-08T05:00:00.000Z");
  assert.equal(midnight("America/New_York", "2026-11-01"), "2026-11-01T04:00:00.000Z");
  // Ordinary winter/summer days in a DST zone use that date's own offset.
  assert.equal(midnight("America/New_York", "2026-01-15"), "2026-01-15T05:00:00.000Z");
  assert.equal(midnight("America/New_York", "2026-07-15"), "2026-07-15T04:00:00.000Z");
  // Fractional offsets: +05:45, +10:30 and +12:45 (the last two observe DST).
  assert.equal(midnight("Asia/Kathmandu", "2026-07-15"), "2026-07-14T18:15:00.000Z");
  assert.equal(midnight("Australia/Lord_Howe", "2026-07-15"), "2026-07-14T13:30:00.000Z");
  assert.equal(midnight("Pacific/Chatham", "2026-09-27"), "2026-09-26T11:15:00.000Z");
});

test("a fixed offset is unaffected by DST on the host", () => {
  const [y, m, d] = [2026, 1, 15];
  const window = resolveLocalWindow(normalizeParams({ query: "x", from_date: "2026-01-15", to_date: "2026-01-15" }), 0);
  assert.equal(window?.startMs, Date.UTC(y, m - 1, d));
  assert.equal(window?.endMs, Date.UTC(y, m - 1, d + 1));
  assert.match(window?.zone ?? "", /UTC\+00:00 \(fixed\)/);
});

test("start padding is applied only when the local day starts before the upstream boundary", async () => {
  const seen: string[] = [];
  const capture: FetchLike = async (url) => {
    seen.push(new URL(url as string).searchParams.get("query") ?? "");
    return jsonResponse({ tweets: [tweet({ createdAt: "Mon Sep 21 10:00:00 +0000 2026" })], has_next_page: false });
  };

  await searchTweets(normalizeParams({ query: "x", count: 5, from_date: "2026-09-21", to_date: "2026-09-21" }), "k", capture, { localUtcOffsetMinutes: MX });
  assert.match(seen[0], /since:2026-09-21/);

  await searchTweets(normalizeParams({ query: "x", count: 5, from_date: "2026-09-21", to_date: "2026-09-21" }), "k", capture, { localUtcOffsetMinutes: 120 });
  assert.match(seen[1], /since:2026-09-20/);
});

test("date filtering is exact at the start and keeps the documented tail gap", async () => {
  const fetcher: FetchLike = async () =>
    jsonResponse({
      tweets: [
        tweet({ id: "in", text: "in", createdAt: "Mon Sep 21 10:00:00 +0000 2026" }),
        tweet({ id: "before", text: "before", createdAt: "Mon Sep 21 05:00:00 +0000 2026" }),
      ],
      has_next_page: false,
    });
  const details = await searchTweets(
    normalizeParams({ query: "x", count: 5, from_date: "2026-09-21", to_date: "2026-09-21" }),
    "k",
    fetcher,
    { localUtcOffsetMinutes: MX },
  );
  assert.deepEqual(details.tweets.map((t) => t.text), ["in"]);
  assert.equal(details.window?.shortfallHours, 2);
});

test("filtering an entire page does not stop pagination early", async () => {
  let calls = 0;
  const fetcher: FetchLike = async () => {
    calls += 1;
    return jsonResponse({
      tweets: [tweet({ id: `o${calls}`, text: "out", createdAt: "Mon Sep 21 01:00:00 +0000 2026" })],
      has_next_page: calls < 2,
      next_cursor: calls < 2 ? `c${calls}` : undefined,
    });
  };
  const details = await searchTweets(
    normalizeParams({ query: "x", count: 5, from_date: "2026-09-21", to_date: "2026-09-21" }),
    "k",
    fetcher,
    { localUtcOffsetMinutes: MX, minRequestIntervalMs: 0 },
  );
  assert.equal(calls, 2, "should keep paging while pages hold no in-window tweets");
  assert.equal(details.tweets.length, 0);
  assert.equal(details.pagesFetched, 2);
});

test("cursor cycles terminate and duplicates are dropped", async () => {
  let calls = 0;
  const fetcher: FetchLike = async () => {
    calls += 1;
    return jsonResponse({ tweets: [tweet()], has_next_page: true, next_cursor: "same" });
  };
  const details = await searchTweets(normalizeParams({ query: "x", count: 10 }), "k", fetcher, { sleep: noSleep });
  assert.equal(calls, 2);
  assert.equal(details.tweets.length, 1, "repeated tweet must not be counted twice");
});

test("dedupes a post that appears once with an id and once with only a permalink", async () => {
  let calls = 0;
  const fetcher: FetchLike = async () => {
    calls += 1;
    // Page 1 carries the id, page 2 the same permalink without an id.
    const tweets =
      calls === 1
        ? [tweet({ id: "77", url: "https://x.com/a/status/77", text: "dup" })]
        : [{ url: "https://x.com/a/status/77", text: "dup" }];
    return jsonResponse({ tweets, has_next_page: calls < 2, next_cursor: calls < 2 ? "c1" : undefined });
  };
  const details = await searchTweets(normalizeParams({ query: "x", count: 10 }), "k", fetcher, { sleep: noSleep });
  assert.equal(calls, 2);
  assert.equal(details.tweets.length, 1, "id/url representations of one post must not both count");
});

test("duplicate-only pages keep paging and fall back to the URL for dedup", async () => {
  let calls = 0;
  const fetcher: FetchLike = async () => {
    calls += 1;
    const tweets = [{ url: "https://x.com/a/status/1", text: "no id", createdAt: "Sun Sep 20 12:00:00 +0000 2026" }];
    return jsonResponse({ tweets, has_next_page: calls < 3, next_cursor: calls < 3 ? `c${calls}` : undefined });
  };
  const details = await searchTweets(normalizeParams({ query: "x", count: 10 }), "k", fetcher, { sleep: noSleep });
  assert.equal(calls, 3, "duplicate-only pages must not end pagination early");
  assert.equal(details.tweets.length, 1, "URL fallback must dedupe id-less repeats");
});

test("window filtering is inclusive at the start and exclusive at the end", async () => {
  const start = Date.UTC(2026, 8, 21, 6, 0, 0);
  const end = Date.UTC(2026, 8, 22, 6, 0, 0);
  const iso = (ms: number) => new Date(ms).toISOString();
  const fetcher: FetchLike = async () =>
    jsonResponse({
      tweets: [
        tweet({ id: "at-start", url: "https://x.com/a/status/1", text: "at-start", createdAt: iso(start) }),
        tweet({ id: "at-end", url: "https://x.com/a/status/2", text: "at-end", createdAt: iso(end) }),
        tweet({ id: "just-before-end", url: "https://x.com/a/status/3", text: "just-before-end", createdAt: iso(end - 1000) }),
      ],
      has_next_page: false,
    });
  const details = await searchTweets(
    normalizeParams({ query: "x", count: 10, from_date: "2026-09-21", to_date: "2026-09-21" }),
    "k",
    fetcher,
    { localUtcOffsetMinutes: MX },
  );
  assert.deepEqual(details.tweets.map((t) => t.text), ["at-start", "just-before-end"]);
});

// ------------------------------------------------------------------- timeouts

test("a stalled fetch times out, is retried, then surfaces the timeout", async () => {
  let calls = 0;
  const hung: FetchLike = () => {
    calls += 1;
    return new Promise<Response>(() => {}); // never settles
  };
  await assert.rejects(
    searchTweets(normalizeParams({ query: "x", count: 1 }), "k", hung, {
      timeoutMs: 15,
      maxRetries: 1,
      sleep: noSleep,
    }),
    /timed out after 15ms/,
  );
  assert.equal(calls, 2, "timeout must be retried once");
});

test("a stalled fetch times out, while a stalled body reports an already-billed page", async () => {
  // Nothing arrived at all: an ordinary request timeout.
  const hungFetch: FetchLike = () => new Promise<Response>(() => {});
  await assert.rejects(
    searchTweets(normalizeParams({ query: "x", count: 1 }), "k", hungFetch, {
      timeoutMs: 15,
      maxRetries: 0,
      sleep: noSleep,
      minRequestIntervalMs: 0,
    }),
    /timed out after 15ms/,
  );

  // The response ARRIVED and only its body stalled. The page may already have
  // been billed, so this is not a retryable timeout and must say why.
  const hungBody: FetchLike = async () =>
    ({ ok: true, status: 200, headers: { get: () => null }, json: () => new Promise(() => {}) } as unknown as Response);
  await assert.rejects(
    searchTweets(normalizeParams({ query: "x", count: 1 }), "k", hungBody, {
      timeoutMs: 15,
      maxRetries: 0,
      sleep: noSleep,
      minRequestIntervalMs: 0,
    }),
    /body did not finish within 15ms[\s\S]*may already have been billed/,
  );
});

test("cancelling while a fetch is pending rejects promptly", async () => {
  const controller = new AbortController();
  const pending: FetchLike = () => new Promise<Response>(() => {});
  const promise = searchTweets(normalizeParams({ query: "x", count: 1 }), "k", pending, {
    signal: controller.signal,
    timeoutMs: 5_000,
    sleep: noSleep,
  });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(promise, /cancelled/);
});

test("cancelling during backoff stops the wait instead of sitting it out", async () => {
  const controller = new AbortController();
  let calls = 0;
  const fetcher: FetchLike = async () => {
    calls += 1;
    return jsonResponse({}, { status: 429, retryAfter: "30" });
  };
  const started = Date.now();
  const promise = searchTweets(normalizeParams({ query: "x", count: 1 }), "k", fetcher, {
    signal: controller.signal,
    retryBaseDelayMs: 30_000,
  });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(promise, /cancelled/);
  assert.ok(Date.now() - started < 5_000, "must not wait out the 30s backoff");
  assert.equal(calls, 1);
});

test("an already-aborted signal during backoff cancels immediately", async () => {
  const controller = new AbortController();
  const fetcher: FetchLike = async () => jsonResponse({}, { status: 429 });
  await assert.rejects(
    searchTweets(normalizeParams({ query: "x", count: 1 }), "k", fetcher, {
      signal: controller.signal,
      sleep: async (_ms, signal) => {
        controller.abort();
        if (signal?.aborted) throw new Error("twitterapi.io search was cancelled");
      },
    }),
    /cancelled/,
  );
});

test("a throwing injected sleep propagates and does not hang", async () => {
  const fetcher: FetchLike = async () => jsonResponse({}, { status: 429 });
  await assert.rejects(
    searchTweets(normalizeParams({ query: "x", count: 1 }), "k", fetcher, {
      sleep: async () => { throw new Error("sleep exploded"); },
    }),
    /sleep exploded/,
  );
});

test("HTTP-date Retry-After is honored end to end", async () => {
  const sleeps: number[] = [];
  let calls = 0;
  const past = new Date(Date.now() - 60_000).toUTCString();
  const fetcher: FetchLike = async () => {
    calls += 1;
    return calls === 1
      ? jsonResponse({}, { status: 429, retryAfter: past })
      : jsonResponse({ tweets: [tweet()], has_next_page: false });
  };
  await searchTweets(normalizeParams({ query: "x", count: 1 }), "k", fetcher, {
    sleep: async (ms) => { sleeps.push(ms); },
  });
  assert.deepEqual(sleeps, [5_000], "an expired HTTP-date falls back to the backoff floor, not a zero-delay retry");
});

// --------------------------------------------------------------- error paths

test("surfaces both error envelopes and rejects malformed success payloads", async () => {
  const semantic: FetchLike = async () => jsonResponse({ status: "error", msg: "bad key" });
  await assert.rejects(searchTweets(normalizeParams({ query: "x" }), "k", semantic), /bad key/);

  const httpError: FetchLike = async () => jsonResponse({ detail: "nope" }, { status: 400 });
  await assert.rejects(searchTweets(normalizeParams({ query: "x" }), "k", httpError), /nope/);

  const msgOnly: FetchLike = async () => jsonResponse({ msg: "quota" }, { status: 403 });
  await assert.rejects(searchTweets(normalizeParams({ query: "x" }), "k", msgOnly), /quota/);

  // The account-level envelope is `{error, message}`; a 402 must not degrade to
  // a bare status. This is the exact shape a depleted balance returns.
  const outOfCredits: FetchLike = async () =>
    jsonResponse({ error: "Unauthorized", message: "Credits is not enough.Please recharge" }, { status: 402 });
  await assert.rejects(
    searchTweets(normalizeParams({ query: "x" }), "k", outOfCredits, { sleep: noSleep, minRequestIntervalMs: 0 }),
    /payment required: Credits is not enough\.Please recharge \(HTTP 402\)/,
  );
  // 402 is a billing signal, not a transient one: it must not be retried.
  let billingCalls = 0;
  const billing: FetchLike = async () => {
    billingCalls += 1;
    return jsonResponse({ error: "Unauthorized", message: "Credits is not enough.Please recharge" }, { status: 402 });
  };
  await assert.rejects(searchTweets(normalizeParams({ query: "x" }), "k", billing, { sleep: noSleep, minRequestIntervalMs: 0 }), /402/);
  assert.equal(billingCalls, 1, "a billing failure must not be retried");

  const missingArray: FetchLike = async () => jsonResponse({ has_next_page: false });
  await assert.rejects(searchTweets(normalizeParams({ query: "x" }), "k", missingArray), /missing tweets array/);

  const notObject: FetchLike = async () =>
    ({ ok: true, status: 200, headers: { get: () => null }, json: async () => "nope" } as unknown as Response);
  await assert.rejects(searchTweets(normalizeParams({ query: "x" }), "k", notObject), /malformed response/);
});

// -------------------------------------------------------------- formatting

test("parses X timestamps with signed offsets and falls back to ISO", () => {
  assert.equal(parseTweetDate("Thu Oct 01 04:02:43 +0000 2026"), Date.UTC(2026, 9, 1, 4, 2, 43));
  assert.equal(parseTweetDate("Thu Oct 01 04:02:43 -0500 2026"), Date.UTC(2026, 9, 1, 9, 2, 43));
  assert.equal(parseTweetDate("Thu Oct 01 04:02:43 +0530 2026"), Date.UTC(2026, 8, 30, 22, 32, 43));
  assert.equal(parseTweetDate("2026-10-01T04:02:43Z"), Date.UTC(2026, 9, 1, 4, 2, 43));
  assert.equal(parseTweetDate(undefined), undefined);
  assert.equal(parseTweetDate("garbage"), undefined);
});

test("alias chains across representations collapse to one post", async () => {
  // (id=1,url=A), then (id=1,url=B), then (no id,url=B): all three are one post.
  const pages = [
    [{ id: "1", url: "https://x.com/a/status/1", text: "first" }],
    [{ id: "1", url: "https://x.com/a/status/1?s=20", text: "second" }],
    [{ url: "https://x.com/a/status/1?s=20", text: "third" }],
  ];
  let call = 0;
  const fetcher: FetchLike = async () => {
    const tweets = pages[Math.min(call, pages.length - 1)];
    call += 1;
    return jsonResponse({ tweets, has_next_page: call < pages.length, next_cursor: call < pages.length ? `c${call}` : undefined });
  };
  const details = await searchTweets(normalizeParams({ query: "x", count: 10 }), "k", fetcher, { sleep: noSleep });
  assert.equal(call, 3, "pagination must still advance through duplicate-only pages");
  assert.equal(details.tweets.length, 1, "the alias chain must not yield three posts");
  assert.equal(details.tweets[0].text, "first");
});

test("retries only the documented statuses (429 and 503)", async () => {
  let retried = 0;
  const flaky: FetchLike = async () => {
    retried += 1;
    return retried === 1
      ? jsonResponse({ detail: "service unavailable" }, { status: 503 })
      : jsonResponse({ tweets: [tweet()], has_next_page: false });
  };
  const details = await searchTweets(normalizeParams({ query: "x", count: 1 }), "k", flaky, {
    sleep: noSleep,
    minRequestIntervalMs: 0,
  });
  assert.equal(retried, 2, "503 is retried");
  assert.equal(details.tweets.length, 1);

  // Other 5xx statuses are outside the documented scope: reported at once, with
  // the status intact even though the body is not JSON.
  for (const status of [500, 502, 504, 507]) {
    let calls = 0;
    const failing: FetchLike = async () => {
      calls += 1;
      return { ok: false, status, headers: { get: () => null }, json: async () => { throw new SyntaxError("Unexpected token <"); } } as unknown as Response;
    };
    await assert.rejects(
      searchTweets(normalizeParams({ query: "x", count: 1 }), "k", failing, { sleep: noSleep, minRequestIntervalMs: 0 }),
      new RegExp(`HTTP ${status}`),
    );
    assert.equal(calls, 1, `HTTP ${status} must not be retried`);
  }

  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(503), true);
  for (const status of [400, 404, 500, 502, 504, 507, 599, 600]) {
    assert.equal(isRetryableStatus(status), false, `${status} is outside the documented retry scope`);
  }
});

test("a non-JSON error body still reports its HTTP status and retry context", async () => {
  let calls = 0;
  const html429: FetchLike = async () => {
    calls += 1;
    return { ok: false, status: 429, headers: { get: () => null }, json: async () => { throw new SyntaxError("Unexpected token <"); } } as unknown as Response;
  };
  await assert.rejects(
    searchTweets(normalizeParams({ query: "x", count: 1 }), "k", html429, {
      sleep: noSleep,
      minRequestIntervalMs: 0,
      maxRetries: 1,
    }),
    /rate limited[\s\S]*HTTP 429[\s\S]*after 2 attempts/,
  );
  assert.equal(calls, 2, "an HTML 429 is still retried as a 429");
});

// ------------------------------------------------------- pacing and truncation

test("paces successive requests to stay inside the per-key QPS ceiling", async () => {
  const clock = { t: 0 };
  const sleeps: number[] = [];
  let calls = 0;
  const fetcher: FetchLike = async () => {
    calls += 1;
    return calls === 1
      ? jsonResponse({ tweets: [tweet()], has_next_page: true, next_cursor: "c1" })
      : jsonResponse({ tweets: [tweet({ id: "2", url: "https://x.com/a/status/2" })], has_next_page: false });
  };
  const details = await searchTweets(normalizeParams({ query: "x", count: 5 }), "k", fetcher, {
    sleep: async (ms) => { sleeps.push(ms); },
    now: () => clock.t,
    minRequestIntervalMs: 5_000,
  });
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [5_000], "the second request must wait out the interval");
  assert.equal(details.pagesFetched, 2, "pacing must not be counted as a retry or extra page");

  // The first request is never delayed.
  const firstOnly = await searchTweets(normalizeParams({ query: "x", count: 1 }), "k", fetcher, {
    sleep: noSleep,
    minRequestIntervalMs: 5_000,
  });
  assert.equal(firstOnly.stoppedBy, "target");
});

test("discloses page-cap and cursor-cycle termination instead of implying completeness", async () => {
  let calls = 0;
  const neverEnding: FetchLike = async () => {
    calls += 1;
    return jsonResponse({
      tweets: [tweet({ id: String(calls), url: `https://x.com/a/status/${calls}` })],
      has_next_page: true,
      next_cursor: `c${calls}`,
    });
  };
  const capped = await searchTweets(normalizeParams({ query: "x", count: 50 }), "k", neverEnding, {
    sleep: noSleep,
    maxPages: 3,
    minRequestIntervalMs: 0,
  });
  assert.equal(capped.pagesFetched, 3);
  assert.equal(capped.stoppedBy, "page-cap");
  assert.equal(capped.truncated, true, "hitting the page cap while more pages exist is truncation");

  let cycleCalls = 0;
  const cycling: FetchLike = async () => {
    cycleCalls += 1;
    return jsonResponse({
      tweets: [tweet({ id: String(cycleCalls), url: `https://x.com/a/status/${cycleCalls}` })],
      has_next_page: true,
      next_cursor: "same",
    });
  };
  const cycled = await searchTweets(normalizeParams({ query: "x", count: 50 }), "k", cycling, {
    sleep: noSleep,
    minRequestIntervalMs: 0,
  });
  assert.equal(cycled.stoppedBy, "cursor-cycle");
  assert.equal(cycled.truncated, true, "a repeating cursor means retrieval was incomplete");

  const exact = await searchTweets(normalizeParams({ query: "x", count: 1 }), "k", async () =>
    jsonResponse({ tweets: [tweet()], has_next_page: true, next_cursor: "c" }), { sleep: noSleep, minRequestIntervalMs: 0 });
  assert.equal(exact.stoppedBy, "target");
  assert.equal(exact.truncated, false, "reaching the requested count is a complete answer");

  const done = await searchTweets(normalizeParams({ query: "x", count: 10 }), "k", async () =>
    jsonResponse({ tweets: [tweet()], has_next_page: false }), { sleep: noSleep, minRequestIntervalMs: 0 });
  assert.equal(done.stoppedBy, "exhausted");
  assert.equal(done.truncated, false, "a normal end of results is not truncation");
});

// ------------------------------------------------- adaptive page budget (trim band)

test("extends the page budget to page past the trim band east of UTC-4", async () => {
  // Local day 2026-09-25 at UTC+2 = [2026-09-24T22:00Z, 2026-09-25T22:00Z).
  // The upstream resolves bounds at 04:00 UTC, so it also returns posts from the
  // following 6h — and those arrive first in a newest-first scan.
  const createdAtFor = (n: number) =>
    ["Fri Sep 25 23:00:00 +0000 2026", "Sat Sep 26 01:00:00 +0000 2026", "Fri Sep 25 22:30:00 +0000 2026", "Fri Sep 25 12:00:00 +0000 2026"][n - 1];
  let calls = 0;
  const fetcher: FetchLike = async () => {
    calls += 1;
    return jsonResponse({
      tweets: [tweet({ id: String(calls), url: `https://x.com/a/status/${calls}`, createdAt: createdAtFor(calls) })],
      has_next_page: calls < 4,
      next_cursor: `c${calls}`,
    });
  };
  const details = await searchTweets(
    normalizeParams({ query: "x", count: 1, from_date: "2026-09-25", to_date: "2026-09-25" }),
    "k",
    fetcher,
    { localUtcOffsetMinutes: 120, maxPages: 2, maxPagesCeiling: 6, sleep: noSleep, minRequestIntervalMs: 0 },
  );

  assert.equal(details.window?.trimHours, 6, "UTC+2 has a 6h trim band");
  assert.equal(calls, 4, "the budget must extend past the band to reach the window");
  assert.equal(details.tweets.length, 1, "the in-window post is returned");
  assert.equal(details.stoppedBy, "target");
  assert.equal(details.trimmedNewer, 3);
  assert.equal(details.truncated, false);
});

test("does not extend the budget where there is no trim band (UTC-6)", async () => {
  // At UTC-6 the upstream boundary falls 2h *before* the window end, so nothing
  // is ever discarded for being too new. A page yielding nothing here is a real
  // end of results, and must not buy extra pages.
  let calls = 0;
  const fetcher: FetchLike = async () => {
    calls += 1;
    return jsonResponse({
      tweets: [tweet({ id: String(calls), createdAt: "Sat Sep 26 07:00:00 +0000 2026" })],
      has_next_page: true,
      next_cursor: `c${calls}`,
    });
  };
  const details = await searchTweets(
    normalizeParams({ query: "x", count: 1, from_date: "2026-09-25", to_date: "2026-09-25" }),
    "k",
    fetcher,
    { localUtcOffsetMinutes: -360, maxPages: 2, maxPagesCeiling: 10, sleep: noSleep, minRequestIntervalMs: 0 },
  );

  assert.equal(details.window?.trimHours, 0, "UTC-6 has no trim band");
  assert.equal(calls, 2, "no extension without a band");
  assert.equal(details.stoppedBy, "page-cap");
  assert.equal(details.truncated, true, "an exhausted budget is still disclosed as truncation");
  assert.equal(details.trimmedNewer, 2);
});

test("stops at the ceiling rather than paging forever through a dense band", async () => {
  let calls = 0;
  const fetcher: FetchLike = async () => {
    calls += 1;
    return jsonResponse({
      tweets: [tweet({ id: String(calls), createdAt: "Fri Sep 25 23:59:00 +0000 2026" })],
      has_next_page: true,
      next_cursor: `c${calls}`,
    });
  };
  const details = await searchTweets(
    normalizeParams({ query: "x", count: 5, from_date: "2026-09-25", to_date: "2026-09-25" }),
    "k",
    fetcher,
    { localUtcOffsetMinutes: 120, maxPages: 2, maxPagesCeiling: 4, sleep: noSleep, minRequestIntervalMs: 0 },
  );

  assert.equal(calls, 4, "the ceiling bounds the spend");
  assert.equal(details.pagesFetched, 4);
  assert.equal(details.tweets.length, 0);
  assert.equal(details.stoppedBy, "page-cap");
  assert.equal(details.truncated, true);
});

test("a stalled body on a received response is not retried even with retries enabled", async () => {
  // The response arrived, so the page may already be billed. A body timeout must
  // surface rather than being classified as a retryable request timeout.
  let calls = 0;
  const stalled: FetchLike = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: () => new Promise(() => {}),
    } as unknown as Response;
  };
  await assert.rejects(
    searchTweets(normalizeParams({ query: "x", count: 1 }), "k", stalled, {
      sleep: noSleep,
      minRequestIntervalMs: 0,
      maxRetries: 3,
      timeoutMs: 25,
    }),
    /may already have been billed/,
  );
  assert.equal(calls, 1, "a page that may already be billed must not be requested again");
});

test("an explicit ceiling caps the base budget instead of being raised by it", async () => {
  let calls = 0;
  const fetcher: FetchLike = async () => {
    calls += 1;
    return jsonResponse({
      tweets: [tweet({ id: String(calls), createdAt: "Fri Sep 25 23:59:00 +0000 2026" })],
      has_next_page: true,
      next_cursor: `c${calls}`,
    });
  };
  const details = await searchTweets(
    normalizeParams({ query: "x", count: 5, from_date: "2026-09-25", to_date: "2026-09-25" }),
    "k",
    fetcher,
    { localUtcOffsetMinutes: 120, maxPages: 5, maxPagesCeiling: 2, sleep: noSleep, minRequestIntervalMs: 0 },
  );
  assert.equal(calls, 2, "the ceiling wins over a larger base budget");
  assert.equal(details.pagesFetched, 2);
  assert.equal(details.truncated, true);
});

test("non-integer page options fall back to defaults rather than unbounded paging", async () => {
  let calls = 0;
  const fetcher: FetchLike = async () => {
    calls += 1;
    return jsonResponse({
      tweets: [tweet({ id: String(calls), createdAt: "Fri Sep 25 23:59:00 +0000 2026" })],
      has_next_page: true,
      next_cursor: `c${calls}`,
    });
  };
  const details = await searchTweets(
    normalizeParams({ query: "x", count: 50, from_date: "2026-09-25", to_date: "2026-09-25" }),
    "k",
    fetcher,
    {
      localUtcOffsetMinutes: 120,
      maxPages: Number.POSITIVE_INFINITY,
      maxPagesCeiling: Number.POSITIVE_INFINITY,
      sleep: noSleep,
      minRequestIntervalMs: 0,
    },
  );
  assert.equal(calls, DEFAULT_MAX_PAGES_CEILING, "Infinity must not remove the termination bound");
  assert.equal(details.pagesFetched, DEFAULT_MAX_PAGES_CEILING);
});

test("older start-padding discards do not buy free pages", async () => {
  // UTC+2 window starts 2026-09-24T22:00Z; these posts are OLDER than it, i.e.
  // the padded day. They sit at the tail of the scan, so paging on gains nothing.
  let calls = 0;
  const fetcher: FetchLike = async () => {
    calls += 1;
    return jsonResponse({
      tweets: [tweet({ id: String(calls), createdAt: "Thu Sep 24 12:00:00 +0000 2026" })],
      has_next_page: true,
      next_cursor: `c${calls}`,
    });
  };
  const details = await searchTweets(
    normalizeParams({ query: "x", count: 5, from_date: "2026-09-25", to_date: "2026-09-25" }),
    "k",
    fetcher,
    { localUtcOffsetMinutes: 120, maxPages: 2, maxPagesCeiling: 10, sleep: noSleep, minRequestIntervalMs: 0 },
  );
  assert.equal(calls, 2, "older discards are charged to the budget");
  assert.equal(details.trimmedOlder, 2);
  assert.equal(details.trimmedNewer, undefined);
  assert.equal(details.stoppedBy, "page-cap");
});

test("HTTP status wins over a semantic error envelope in the same body", async () => {
  const both: FetchLike = async () => jsonResponse({ status: "error", msg: "slow down" }, { status: 429 });
  await assert.rejects(
    searchTweets(normalizeParams({ query: "x" }), "k", both, { sleep: noSleep, minRequestIntervalMs: 0, maxRetries: 1 }),
    /rate limited: slow down \(HTTP 429 after 2 attempts\)/,
  );
});

// ------------------------------------------------------- accounts and threads

/** A user object shaped like the live endpoint (which differs from the docs). */
function apiUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "1720665183188922368",
    screen_name: "grok",
    name: "Grok",
    description: "@grok it",
    followers_count: 9119929,
    following_count: 4,
    isBlueVerified: true,
    // The API's own `url` is a t.co redirect, not the profile link.
    url: "https://t.co/fqNKQSjjG9",
    ...overrides,
  };
}

test("searchUsers maps the live field names and builds profile URLs", async () => {
  const fetcher: FetchLike = async () =>
    jsonResponse({
      users: [
        apiUser(),
        apiUser({ id: "2", screen_name: "grokbot", name: "Grok Bot", url: "https://t.co/other" }),
        apiUser({ id: "3", screen_name: undefined, userName: undefined, username: null }), // dropped
      ],
      has_next_page: false,
    });
  const details = await searchUsers("grok", "k", fetcher, { sleep: noSleep, minRequestIntervalMs: 0 });

  assert.equal(details.users.length, 2, "an account without a handle is dropped");
  const [first] = details.users;
  assert.equal(first.handle, "grok");
  assert.equal(first.followers, 9_119_929, "followers_count is the real field");
  assert.equal(first.following, 4);
  assert.equal(first.verified, true);
  assert.equal(first.bio, "@grok it");
  assert.equal(first.profileUrl, "https://x.com/grok", "profile URL is constructed, never the t.co redirect");
  assert.equal(details.stoppedBy, "exhausted");
  assert.equal(details.truncated, false);
});

test("searchUsers paginates, dedupes, and reports a page-cap truncation", async () => {
  let calls = 0;
  const fetcher: FetchLike = async () => {
    calls += 1;
    return jsonResponse({
      users: [apiUser({ id: "1", screen_name: "grok" }), apiUser({ id: String(calls + 10), screen_name: `extra${calls}` })],
      has_next_page: true,
      next_cursor: `c${calls}`,
    });
  };
  const details = await searchUsers("grok", "k", fetcher, {
    maxPages: 2,
    count: 50,
    sleep: noSleep,
    minRequestIntervalMs: 0,
  });
  assert.equal(calls, 2);
  assert.equal(details.users.length, 3, "the duplicate handle is not repeated across pages");
  assert.equal(details.stoppedBy, "page-cap");
  assert.equal(details.truncated, true, "accounts remained upstream");
});

test("searchUsers stops at the requested count", async () => {
  let calls = 0;
  const fetcher: FetchLike = async () => {
    calls += 1;
    return jsonResponse({
      users: Array.from({ length: 20 }, (_, i) => apiUser({ id: `${calls}-${i}`, screen_name: `h${calls}x${i}` })),
      has_next_page: true,
      next_cursor: `c${calls}`,
    });
  };
  const details = await searchUsers("x", "k", fetcher, { count: 5, sleep: noSleep, minRequestIntervalMs: 0 });
  assert.equal(details.users.length, 5);
  assert.equal(details.stoppedBy, "target");
  assert.equal(calls, 1);
});

test("fetchThread accepts an id or a permalink and stops when a page adds nothing", async () => {
  const seen: string[] = [];
  let calls = 0;
  const fetcher: FetchLike = async (input) => {
    seen.push(String(input));
    calls += 1;
    if (calls === 1) {
      return jsonResponse({
        status: "success",
        tweets: [tweet({ id: "7", url: "https://x.com/a/status/7" })],
        has_next_page: true,
        next_cursor: "c1",
      });
    }
    // Upstream warns has_next_page can be true with no further data.
    return jsonResponse({ status: "success", tweets: [], has_next_page: true, next_cursor: "c2" });
  };

  const details = await fetchThread("https://x.com/a/status/7/photo/1", "k", fetcher, {
    sleep: noSleep,
    minRequestIntervalMs: 0,
  });
  assert.equal(details.tweetId, "7", "the id is extracted from a permalink");
  assert.match(seen[0], /tweetId=7/);
  assert.equal(details.tweets.length, 1);
  assert.equal(calls, 2, "a page that adds nothing ends the walk even though upstream claims more");
});

test("fetchThread rejects a reference that is neither an id nor a permalink", async () => {
  const neverCalled: FetchLike = async () => {
    throw new Error("the fetcher must not be reached for an invalid reference");
  };
  await assert.rejects(() => fetchThread("not-a-tweet", "k", neverCalled), /numeric post id or an X permalink/);
});

test("tweetIdFromInput and statusIdFromUrl agree on the X URL boundary", () => {
  assert.equal(tweetIdFromInput("12345"), "12345");
  assert.equal(tweetIdFromInput("https://x.com/a/status/12345"), "12345");
  assert.equal(tweetIdFromInput("https://twitter.com/a/statuses/12345"), "12345");
  assert.equal(tweetIdFromInput("https://x.com/a/status/12345/photo/1"), "12345");
  assert.equal(tweetIdFromInput("https://x.com/search?q=/status/12345"), undefined);
  assert.equal(tweetIdFromInput("https://example.org/a/status/12345"), undefined);
  assert.equal(tweetIdFromInput("https://x.com/a/status/12345garbage"), undefined);
  assert.equal(statusIdFromUrl("https://x.com/a/status/12345"), "12345");
});

test("a duplicate-only thread page does not end the walk", async () => {
  // Pagination overlap is normal: [A] -> [A] -> [B] must still reach B.
  let calls = 0;
  const fetcher: FetchLike = async () => {
    calls += 1;
    if (calls === 1) {
      return jsonResponse({ status: "success", tweets: [tweet({ id: "A", url: "https://x.com/a/status/1" })], has_next_page: true, next_cursor: "c1" });
    }
    if (calls === 2) {
      return jsonResponse({ status: "success", tweets: [tweet({ id: "A", url: "https://x.com/a/status/1" })], has_next_page: true, next_cursor: "c2" });
    }
    return jsonResponse({ status: "success", tweets: [tweet({ id: "B", url: "https://x.com/a/status/2" })], has_next_page: false });
  };
  const details = await fetchThread("1", "k", fetcher, { sleep: noSleep, minRequestIntervalMs: 0 });
  assert.equal(calls, 3, "an overlapping page must not stop retrieval");
  assert.deepEqual(details.tweets.map((t) => t.id), ["A", "B"]);
  assert.equal(details.stoppedBy, "exhausted");
});

test("running out of pages on repeat-only pages is disclosed as truncation", async () => {
  let cursor = 0;
  const fetcher: FetchLike = async () => {
    cursor += 1; // a fresh cursor each time, so the page cap is what stops it
    return jsonResponse({ status: "success", tweets: [tweet({ id: "A", url: "https://x.com/a/status/1" })], has_next_page: true, next_cursor: `c${cursor}` });
  };
  const details = await fetchThread("1", "k", fetcher, { maxPages: 3, sleep: noSleep, minRequestIntervalMs: 0 });
  assert.equal(details.pagesFetched, 3);
  assert.equal(details.stoppedBy, "page-cap");
  assert.equal(details.truncated, true, "stopping early must not claim the thread was fully read");
});

test("account dedupe catches mixed id and handle representations", async () => {
  const fetcher: FetchLike = async () =>
    jsonResponse({
      users: [
        apiUser({ id: "1", screen_name: "grok" }),
        apiUser({ id: undefined, screen_name: "GROK" }), // same account, no id, different case
        apiUser({ id: "2", screen_name: "other" }),
      ],
      has_next_page: false,
    });
  const details = await searchUsers("grok", "k", fetcher, { count: 10, sleep: noSleep, minRequestIntervalMs: 0 });
  assert.deepEqual(details.users.map((u) => u.handle), ["grok", "other"]);
  assert.equal(details.stoppedBy, "exhausted");
});

test("an invalid account count or page bound is rejected, not defaulted", async () => {
  const fetcher: FetchLike = async () => jsonResponse({ users: [], has_next_page: false });
  await assert.rejects(() => searchUsers("x", "k", fetcher, { count: 0 }), /count must be an integer between 1 and 50/);
  await assert.rejects(() => searchUsers("x", "k", fetcher, { count: 1.5 }), /count must be an integer between 1 and 50/);
  await assert.rejects(() => searchUsers("x", "k", fetcher, { maxPages: 0 }), /maxPages must be an integer between 1 and 100/);
});

test("more-results-without-a-cursor is truncation, not completion", async () => {
  // Upstream says there are more pages but hands us nothing to fetch them with.
  // Reporting "exhausted" would present a partial result as complete.
  const users: FetchLike = async () => jsonResponse({ users: [apiUser({ id: "1", screen_name: "a" })], has_next_page: true });
  const userSearch = await searchUsers("x", "k", users, { count: 50, sleep: noSleep, minRequestIntervalMs: 0 });
  assert.equal(userSearch.stoppedBy, "cursor-missing");
  assert.equal(userSearch.truncated, true);

  const thread: FetchLike = async () =>
    jsonResponse({ status: "success", tweets: [tweet({ id: "1", url: "https://x.com/a/status/1" })], has_next_page: true });
  const threadFetch = await fetchThread("1", "k", thread, { sleep: noSleep, minRequestIntervalMs: 0 });
  assert.equal(threadFetch.stoppedBy, "cursor-missing");
  assert.equal(threadFetch.truncated, true);

  const posts: FetchLike = async () => jsonResponse({ tweets: [tweet()], has_next_page: true });
  const postSearch = await searchTweets(normalizeParams({ query: "x", count: 50 }), "k", posts, { sleep: noSleep, minRequestIntervalMs: 0 });
  assert.equal(postSearch.stoppedBy, "cursor-missing");
  assert.equal(postSearch.truncated, true);

  // A genuine end of results still reads as exhausted.
  const done: FetchLike = async () => jsonResponse({ users: [apiUser({ id: "1", screen_name: "a" })], has_next_page: false });
  const finished = await searchUsers("x", "k", done, { count: 50, sleep: noSleep, minRequestIntervalMs: 0 });
  assert.equal(finished.stoppedBy, "exhausted");
  assert.equal(finished.truncated, false);
});

test("an empty page does not end post or account paging, but does end a thread walk", async () => {
  // Documented behaviour: post and account paging follows the upstream cursor,
  // so an empty page is not itself a reason to stop. A thread fetch is the
  // exception, where a genuinely empty page ends the walk.
  let calls = 0;
  const posts: FetchLike = async () => {
    calls += 1;
    return calls === 1
      ? jsonResponse({ tweets: [], has_next_page: true, next_cursor: "c1" })
      : jsonResponse({ tweets: [tweet({ id: "later" })], has_next_page: false });
  };
  const postSearch = await searchTweets(normalizeParams({ query: "x", count: 50 }), "k", posts, { sleep: noSleep, minRequestIntervalMs: 0 });
  assert.equal(postSearch.tweets.length, 1, "the walk continued past the empty page");
  assert.equal(postSearch.pagesFetched, 2);
  assert.equal(postSearch.stoppedBy, "exhausted");

  let userCalls = 0;
  const users: FetchLike = async () => {
    userCalls += 1;
    return userCalls === 1
      ? jsonResponse({ users: [], has_next_page: true, next_cursor: "c1" })
      : jsonResponse({ users: [apiUser({ id: "9", screen_name: "later" })], has_next_page: false });
  };
  const userSearch = await searchUsers("x", "k", users, { count: 50, sleep: noSleep, minRequestIntervalMs: 0 });
  assert.equal(userSearch.users.length, 1);
  assert.equal(userSearch.pagesFetched, 2);

  const thread: FetchLike = async () => jsonResponse({ status: "success", tweets: [], has_next_page: true, next_cursor: "c1" });
  const threadFetch = await fetchThread("1", "k", thread, { sleep: noSleep, minRequestIntervalMs: 0 });
  assert.equal(threadFetch.stoppedBy, "exhausted", "an empty thread page ends the walk");
  assert.equal(threadFetch.pagesFetched, 1);
});

test("retry attempts are spaced by retryBaseDelayMs, not by the paging interval", async () => {
  // Documented in the README: minRequestIntervalMs spaces pages, while retry
  // attempts use retryBaseDelayMs. A zeroed retry delay therefore retries
  // immediately even with a five-second paging interval in force.
  const times: number[] = [];
  let clock = 0;
  let calls = 0;
  const fetcher: FetchLike = async () => {
    calls += 1;
    times.push(clock);
    return calls === 1
      ? jsonResponse({ detail: "rate limited" }, { status: 429, retryAfter: "0" })
      : jsonResponse({ users: [apiUser({ id: "1", screen_name: "a" })], has_next_page: false });
  };
  const result = await searchUsers("x", "k", fetcher, {
    count: 20,
    minRequestIntervalMs: 5000,
    retryBaseDelayMs: 0,
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
  });
  assert.equal(result.users.length, 1, "the retry succeeded");
  assert.deepEqual(times, [0, 0], "the retry is not paced by minRequestIntervalMs");
});

test("a filled count is a complete result even when the cursor is missing", async () => {
  // Documented: missing-cursor truncation applies while the requested count is
  // still unfilled. Once count is satisfied the walk stopped because it was
  // asked to, so reporting truncation would be wrong.
  const posts: FetchLike = async () => jsonResponse({ tweets: [tweet({ id: "1" })], has_next_page: true });
  const filled = await searchTweets(normalizeParams({ query: "x", count: 1 }), "k", posts, { sleep: noSleep, minRequestIntervalMs: 0 });
  assert.equal(filled.stoppedBy, "target");
  assert.equal(filled.truncated, false, "a satisfied count is not truncation");

  const unfilled = await searchTweets(normalizeParams({ query: "x", count: 2 }), "k", posts, { sleep: noSleep, minRequestIntervalMs: 0 });
  assert.equal(unfilled.stoppedBy, "cursor-missing", "the same page while count is unfilled is truncation");
  assert.equal(unfilled.truncated, true);
});
