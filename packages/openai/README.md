# @pi-lab/openai

Fast request controls and native Web Search for Pi's **OpenAI → Sign in with ChatGPT** connection. Uses Pi's public extension hooks; no replacement provider, additional search model call, or separate login.

## Try locally

From the repository root:

```bash
pi -e ./packages/openai/src/index.ts
```

Pi loads the TypeScript source directly; no build step is needed. The published package includes its runtime source and a bundled copy of the private `@pi-lab/utils` TypeScript source, not compiled output or either package's tests. Utils does not need to be published or installed separately.

Select an `openai` model and log in with **Sign in with ChatGPT**. The extension only changes requests using the `openai-responses` API at `https://api.openai.com/v1` with OAuth. API keys, `openai-codex`, custom endpoints and other providers are left unchanged.

## Configure

Create either or both files:

- Global: `~/.pi/agent/pi-lab/openai.json`
- Project: `<cwd>/.pi/pi-lab/openai.json`

```json
{
  "openai": {
    "fast": false,
    "webSearch": true
  }
}
```

Both options default to `false`. Project values override individual global values, including explicit `false`. Configurations are read at session startup and `/reload`; invalid JSON, non-boolean options and unknown options within `openai` report an error and leave this extension inactive until corrected and reloaded.

### Fast mode

| Command | Effect |
| --- | --- |
| `/fast` | Toggle the session's Fast setting |
| `/fast on` | Request Fast processing |
| `/fast off` | Request standard processing |
| `/fast status` | Show the setting without changing it |

Changes affect the next request, not an in-flight request. They are saved in the session, not written to either configuration file. Resume, reload and forks restore the active branch's latest override; tree navigation follows the selected branch. A new session uses the file configuration.

For eligible requests during an active model turn, on sends `service_tier: "fast"`; off sends `service_tier: "default"`. This overrides any tier already in that request payload. The status bar shows the requested setting, or `n/a` when the selected model/authentication/endpoint is outside the supported scope. After the corresponding assistant message finishes, the status also shows its last observed service tier, if the response supplied one. **`Fast: on` does not certify that the server used Fast processing.**

The [general OpenAI API documents Fast mode](https://developers.openai.com/api/docs/guides/fast-mode), but its availability and usage rules through **Sign in with ChatGPT have not been verified**. Enabling it is an explicit opt-in to sending the parameter, not a promise of account eligibility or faster responses. The extension does not downgrade and retry rejected requests, switch credentials, or change Pi's retry policy.

### Native Web Search

With `webSearch: true`, the extension adds `{ "type": "web_search" }` to eligible main-model requests. The model decides whether to search; enabling search does not force a search on every turn. Existing tools and existing native search options are preserved. With it disabled, this extension adds no search tool and does not process citations; it does not remove tools supplied by another extension.

While OpenAI emits search-in-progress events, the status bar shows search activity. At message completion, the extension:

- Reads URL citations exposed through Pi's raw provider-stream hook.
- Converts internal citation markers to Markdown links **only when the annotation offsets exactly identify the marker in the final text**.
- Appends a deduplicated list of HTTP(S) source links. If inline positions cannot be matched reliably, it leaves the original text unchanged and supplies the source list instead.
- Returns the decorated assistant message through Pi's `message_end` hook, so links are part of the saved message, subsequent context, resumed sessions and exports. Observed sources can also be preserved on partial or aborted responses.

If provider streams overlap, such as during Pi's streaming cache warming, events without a response ID cannot safely be attributed to one answer. The extension then uses each response's terminal output snapshot for citations. An interrupted overlapping response without that snapshot may have no added source links rather than risk attaching another response's sources.

This is not a full native search transcript. It does not invent Pi tool calls, store a separate raw event log, replay native search output items, or add citation fields to Pi's message schema. Links appear when the message finishes, not incrementally during text streaming. If the provider supplies no usable citations, the extension cannot reconstruct missing URLs or reliably resolve internal markers.

Search availability depends on the model and account/workspace policy. Requests use the existing ChatGPT connection and its usage allowance. Pi's normal provider usage remains unchanged; the extension does not calculate separate search charges or remaining subscription quota. The companion `@pi-lab/websearch` extension yields to native search when these enablement conditions match; see below.

## Using both search extensions

The companion `@pi-lab/websearch` independently reads the same OpenAI configuration and applies matching validation and eligibility rules. Neither extension depends on the other package. When `openai.webSearch` is `true` and the current model uses `openai` / `openai-responses`, the official endpoint and OAuth, it does not expose its standalone search tool. For other models/authentication, or when native search is disabled, the standalone tool is available instead.

Both extensions read configuration at session startup or `/reload` and recheck model eligibility for upcoming turns. Their load order does not matter, and they exchange no runtime events. An already registered standalone tool is withdrawn with Pi's `hidden` exposure and restored when needed; a tool previously disabled by the user is not automatically activated on restoration.

This is a configuration-based choice, not an installation or server-capability probe. Keep the OpenAI extension loaded when setting `openai.webSearch: true`; if you remove it, turn that setting off and `/reload`. Other search plugins do not automatically participate. Rejected native search requests do not silently fall back to the standalone provider.

## Boundaries

- No Pi core changes, private API access, transport replacement or credential copying.
- No extra model calls or automatic capability probes.
- The request hook exposes no resolved-model metadata or request-purpose identifier. The extension only handles payloads whose model matches the selected eligible model during an active turn; it does not attempt to support virtual-model routing or requests redirected by other extensions. Idle cache-warming requests are left unchanged, but Pi's own warming requests overlapping an active turn can receive the same options. Warming responses do not update the displayed last assistant-response tier.
- No custom timeout, retry or fallback behavior. Provider errors remain Pi provider errors.
- Payload and citation processing also work without an interactive UI; status rendering is skipped.

## Development

```bash
pnpm typecheck
pnpm --filter @pi-lab/openai test
```

The repository-required `build` script only runs `tsc --noEmit`; it produces no compiled files. Release packaging uses `src/index.ts` directly. The workspace uses pnpm's `hoisted` layout so `pnpm pack` can include utils through standard `bundledDependencies`, without custom copying or import rewriting.

Tests use isolated temporary configuration directories and simulated provider events. They do not read real credentials or make inference requests. Running the tests requires Node.js 24 for scoped temporary-directory cleanup.
