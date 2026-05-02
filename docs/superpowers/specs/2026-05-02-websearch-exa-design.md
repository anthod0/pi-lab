# WebSearch Exa Plugin Design

## Goal

Add a standalone `websearch` pi extension that gives agents a concise, citation-friendly web search tool powered by Exa Search API.

The plugin is **not** an Exa API wrapper. It exposes the parameters most useful for agent search workflows, keeps output short, and leaves page fetching/reading to other independent tools such as `webfetch` when needed.

## Package

Create a new workspace package:

```text
packages/websearch/
```

Package name:

```text
@pi-lab/websearch
```

Entry point:

```text
packages/websearch/src/index.ts
```

The entry point default-exports a pi extension callback following the project convention.

## Tool

Register one tool:

```text
websearch
```

Description:

> Search the web with Exa and return concise, citation-friendly results.

## Authentication

The tool reads the API key from:

```text
EXA_API_KEY
```

If the variable is missing, `websearch` throws a clear error explaining that `EXA_API_KEY` must be configured. Users may load it however they prefer, including via the existing `@pi-lab/env` plugin.

## Parameters

```ts
{
  query: string;
  num_results?: number;
  type?: "auto" | "fast" | "instant" | "deep-lite" | "deep";
  category?: "news" | "research paper" | "company" | "people" | "personal site" | "financial report";
  include_domains?: string[];
  exclude_domains?: string[];
  start_published_date?: string;
  end_published_date?: string;
  fresh?: boolean;
}
```

### Defaults and validation

- `query` is required.
- `num_results` defaults to `5`.
- `num_results` is clamped or validated to a safe agent-oriented range, ideally `1..20`.
- `type` defaults to `"auto"`.
- `fresh` defaults to `false`.
- Date fields are passed as Exa published-date filters. They should be documented as ISO 8601 date strings.

## Exa Request Mapping

Call:

```http
POST https://api.exa.ai/search
x-api-key: $EXA_API_KEY
content-type: application/json
```

Base request:

```json
{
  "query": "...",
  "type": "auto",
  "numResults": 5,
  "contents": {
    "highlights": true
  }
}
```

Optional mappings:

| Tool parameter | Exa parameter |
|---|---|
| `num_results` | `numResults` |
| `type` | `type` |
| `category` | `category` |
| `include_domains` | `includeDomains` |
| `exclude_domains` | `excludeDomains` |
| `start_published_date` | `startPublishedDate` |
| `end_published_date` | `endPublishedDate` |
| `fresh: true` | `contents.maxAgeHours = 0` |

Do not expose these Exa features in this plugin:

- `outputSchema`
- `systemPrompt`
- `stream`
- `contents.text`
- `contents.summary`
- subpages
- extras links/images
- `userLocation`
- raw request passthrough

Rationale: those features are useful for extraction or deep research tools, but they make a general agent search tool harder to use correctly and more token-heavy.

## Output Format

Return Markdown optimized for LLM consumption:

```md
Query: <query>
Type: auto
Results: 5

1. <Title>
   URL: <url>
   Published: <published date if available>
   Author: <author if available>
   Highlights:
   - <highlight>
   - <highlight>

2. <Title>
   URL: <url>
   Highlights:
   - <highlight>
```

Output should favor:

- title
- URL
- published date
- author, if available
- highlights
- short result text or summary only if highlights are absent

Avoid dumping raw JSON into the visible tool output.

The tool result `details` should retain structured data useful for rendering/debugging, including:

- query
- type
- result count
- normalized result objects
- optional raw Exa response fields if small enough

## Error Handling

The tool should throw on:

- missing `EXA_API_KEY`
- empty query
- invalid `num_results`
- non-2xx Exa responses
- malformed Exa responses

Exa API errors should include status code and a concise message. Do not include the API key or sensitive headers in errors.

## Agent Prompt Guidance

Add prompt guidance similar to:

- Use `websearch` when current or external information is needed.
- Prefer natural-language search queries over short keyword-only queries.
- Use `include_domains` when the user asks for official or source-specific results.
- Use `category: "news"` or published-date filters for recent/current events.
- Keep `type` as `auto` unless speed or deeper research is explicitly useful.

## Rendering

Provide a compact custom renderer like existing plugins:

- call row: `websearch <query>` plus type/result count if present
- result row: show count and top result URLs/titles in collapsed mode
- expanded mode may show highlights

Rendering is optional for functionality but should be included for consistency with other pi-lab plugins.

## Testing and Verification

Minimum verification:

1. `pnpm install` after adding the package.
2. `pnpm typecheck` from repo root.
3. `cd packages/websearch && pnpm build`.
4. Manual smoke test with `EXA_API_KEY` set:

```bash
pi -e ./packages/websearch/dist/index.mjs
```

Then ask the agent to search for a simple current or documentation-related topic.

## Non-goals

- Not a replacement for `webfetch`.
- Not responsible for reading full web pages.
- Not a complete Exa Search API wrapper.
- Not a structured extraction or synthesis tool.
