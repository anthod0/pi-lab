# @pi-lab/webfetch

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
