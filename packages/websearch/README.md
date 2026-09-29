# @pi-lab/websearch [![NPM Version](https://img.shields.io/npm/v/@pi-lab/websearch)](https://www.npmjs.com/package/@pi-lab/websearch)

A pi extension that adds a `websearch` tool backed by Exa or Parallel.

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
```

You can load either key through [@pi-lab/env](https://www.npmjs.com/package/@pi-lab/env).

Select a provider with an environment variable:

```bash
export WEBSEARCH_PROVIDER=parallel # exa or parallel
```

Or configure it in user-level `~/.pi/agent/settings.json` or trusted project-level `.pi/settings.json`:

```json
{
  "websearch": {
    "provider": "parallel"
  }
}
```

`WEBSEARCH_PROVIDER` takes precedence over settings, and project settings override user settings. When no provider is configured, the extension selects Parallel if `PARALLEL_API_KEY` is the only available key; otherwise it selects Exa.

## Usage

Ask pi to search the web. The tool returns citation-friendly titles, URLs, dates, and relevant excerpts. Use `webfetch` on a result URL when you need the full page.

The tool accepts:

- `query` (required): natural-language search query.
- `num_results`: 1–20 results; defaults to 5.
- `type`: provider-neutral search depth; `fast`, `balanced` (default), or `deep`.
- `include_domains` and `exclude_domains`: domain filters.
- `start_published_date`: earliest publication date in ISO 8601 format.
- `fresh`: prefer freshly fetched content over cached content.

Search types map to provider modes as follows:

| Type | Exa | Parallel |
|---|---|---|
| `fast` | `instant` | `turbo` |
| `balanced` | `auto` | `fast` |
| `deep` | `deep` | `advanced` |
