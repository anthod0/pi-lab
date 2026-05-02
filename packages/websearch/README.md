# @pi-lab/websearch

A pi extension that adds a `websearch` tool powered by Exa.

## Install

```bash
pi install npm:@pi-lab/websearch
```

## Usage

Set your Exa API key before starting `pi`:

```bash
export EXA_API_KEY=<your-api-key>
pi
```

You can also provide `EXA_API_KEY` through [@pi-lab/env](../env).

Once installed and configured, ask pi to search the web. For example:

```text
Search the web for the latest Exa Search API docs.
```

The tool returns short, citation-friendly results with titles, URLs, dates, authors, and highlights when available. Use `webfetch` on a result URL if you need to read the full page.

## Notes

- `num_results` defaults to 5 and supports 1–20 results.
- Use domain filters when you want official or source-specific results.
- Use news/date filters for recent events.
