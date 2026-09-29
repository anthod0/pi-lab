# @pi-lab/websearch [![NPM Version](https://img.shields.io/npm/v/@pi-lab/websearch)](https://www.npmjs.com/package/@pi-lab/websearch)

A pi extension that adds a `websearch` tool backed by Exa, Parallel, or TinyFish.

## Install

```bash
pi install npm:@pi-lab/websearch
```

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

## Usage

Ask pi to search the web. The tool returns citation-friendly titles, URLs, dates, and relevant excerpts. Use `webfetch` on a result URL when you need the full page.
