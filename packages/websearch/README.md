# @pi-lab/websearch [![NPM Version](https://img.shields.io/npm/v/@pi-lab/websearch)](https://www.npmjs.com/package/@pi-lab/websearch)

A pi extension that adds a `websearch` tool backed by Exa, Parallel, or TinyFish.

## Install

```bash
pi install npm:@pi-lab/websearch
```

Pi loads the published TypeScript source directly; no build step is needed. To try it from this repository:

```bash
pi -e ./packages/websearch/src/index.ts
```

The package includes runtime TypeScript source files and a bundled copy of the private `@pi-lab/utils` source. Neither package's tests nor compiled output are shipped. Utils does not need to be published or installed separately, and this extension has no dependency on `@pi-lab/openai`. The repository-required `build` script only runs `tsc --noEmit`.

## Configure

Provide the API key for the selected provider:

```bash
export EXA_API_KEY=<your-api-key>
# or
export PARALLEL_API_KEY=<your-api-key>
# or
export TINYFISH_API_KEY=<your-api-key>
```

You can load any of these keys through [@pi-lab/env](https://www.npmjs.com/package/@pi-lab/env).

Select a provider with an environment variable:

```bash
export WEBSEARCH_PROVIDER=tinyfish # exa, parallel, or tinyfish
```

Or configure it in user-level `~/.pi/agent/settings.json` or trusted project-level `.pi/settings.json`:

```json
{
  "websearch": {
    "provider": "tinyfish"
  }
}
```

When no provider is configured, API keys are detected in this priority order: Parallel, TinyFish, then Exa. If no provider key is configured, the tool reports a configuration error.

## OpenAI native search takes precedence

When used with `@pi-lab/openai`, this extension reads the same configuration files:

- `~/.pi/agent/pi-lab/openai.json`
- `<cwd>/.pi/pi-lab/openai.json` (project fields override global fields)

```json
{
  "openai": {
    "webSearch": true
  }
}
```

The standalone `websearch` tool yields to native search only when this setting is enabled and the current model uses the `openai` provider, `openai-responses` API, official `https://api.openai.com/v1` endpoint and OAuth authentication. Other providers, API-key authentication and custom endpoints retain standalone search. Each extension independently reads these files and applies matching validation and eligibility rules, without depending on the other extension, runtime communication or load-order dependencies.

Configuration changes take effect on `/reload`. Model and authentication changes are checked before subsequent runs and turns. If standalone search has not been registered yet, it stays unregistered while native search is enabled. If it was already registered, Pi's `hidden` exposure withdraws it from both direct and indirect calls; it is restored when native search no longer applies. Previously user-disabled tools are not automatically activated when restored. Invalid OpenAI configuration reports an error but leaves standalone search available.

Setting `openai.webSearch: true` assumes you also load the OpenAI extension. This extension does not detect installation or probe server support. If you stop loading OpenAI, turn off its search setting and `/reload`. A native search API error does not automatically switch providers.

## Usage

Ask pi to search the web. The tool returns citation-friendly titles, URLs, dates, and relevant excerpts. Use `webfetch` on a result URL when you need the full page.
