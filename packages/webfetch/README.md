# @pi-lab/webfetch [![NPM Version](https://img.shields.io/npm/v/@pi-lab/webfetch)](https://www.npmjs.com/package/@pi-lab/webfetch)

A web fetching extension for [pi coding agent](https://github.com/earendil-works/pi). Adds a `webfetch` tool — fetch any URL and get back clean Markdown, ready for the model to read.

## Install

```bash
pi install npm:@pi-lab/webfetch
```

## Features

- **HTML → Markdown** via [Mozilla Readability](https://github.com/mozilla/readability) (same engine as Firefox Reader Mode) + [Turndown](https://github.com/mixmark-io/turndown). Falls back to full-page conversion if Readability can't extract a main article.
- **Pagination** — large pages are sliced into chunks; the model reads page by page using `offset`.
- **Inline script index** — `<script>` tags are stripped from the Markdown body but listed as a numbered index at the end. The model can read any of them with `script=N`.
- **Redirect handling** — same-domain redirects are followed automatically (up to 10 hops); cross-domain redirects are surfaced to the model so it can decide whether to follow.
- **Binary downloads** — non-text responses (PDFs, images, etc.) are saved to `~/.pi/agent/pi-lab/tmp/webfetch/` and the file path is returned.
- **LRU cache** — processed Markdown is cached in memory so paginating the same URL doesn't re-fetch.
- **Built-in fetch optimizations** — enabled by default. Site-specific rules can parse difficult pages before generic extraction.
  - X/Twitter posts are extracted from the page's `window.__INITIAL_STATE__` script.
  - Reddit post permalinks use Reddit's Atom RSS feed for the post body and up to roughly 500 comments, then enrich the result with Embed media and the displayed comment count. RSS rate limits fall back immediately to Embed, with oEmbed as a final metadata fallback.
- **Text feed support** — JSON, Atom, RSS, and XML responses are returned as text rather than downloaded as binary files.

## Configuration

Disable the built-in optimization framework in pi settings:

```json
{
  "webfetch": {
    "optimizations": false
  }
}
```

User settings live at `~/.pi/agent/settings.json`; project settings live at `<cwd>/.pi/settings.json` and override user settings.

## Reddit limitations

Reddit optimization applies to public `reddit.com/r/.../comments/...` permalinks. Successful RSS-based results are cached in memory by post ID for one hour, so tracking parameters and comment permalinks do not trigger duplicate fetches during the session. Rate-limited fallback results use a short cache lifetime so RSS can be retried later.

Reddit RSS is an anonymous best-effort endpoint: it may be rate limited, returns at most roughly 500 entries, and does not expose comment scores, parent IDs, or reliable thread hierarchy. Private, deleted, age-gated, or otherwise restricted content is not bypassed.
