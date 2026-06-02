# @pi-lab/grok-build

A pi extension that adds a single `grok_build` tool backed by the local [Grok Build](https://docs.x.ai/build/overview) CLI.

The tool intentionally stays prompt-only: Grok Build is itself an agent, so pi gives it a natural-language task and lets Grok choose its own image, video, web, and X/Twitter capabilities.

## Requirements

Install and authenticate `Grok Build` first.

## Capability guidance

| Capability                 | Guidance                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| Image generation           | ✅ Recommended                                                                           |
| Image edit                 | ✅ Recommended                                                                           |
| Video generation           | ✅ Recommended                                                                           |
| X/Twitter search           | ✅ Recommended when Grok-native user, semantic, or advanced keyword search is useful      |
| X/Twitter post/thread read | ✅ Use Grok Build for detailed context; use `webfetch` when faster, simpler output is enough |
| General web search         | ⚠️ Available but not recommended; prefer other `websearch` tool                          |
| General web fetch          | ⚠️ Available but not recommended; prefer other `webfetch` tool                           |
| Coding tasks               | ❌ Not recommended                                                                       |

## Install

```bash
pi install npm:@pi-lab/grok-build
```

## Usage

Ask pi for image or video generation, for example:

```text
Use Grok Build to generate an image of a cyberpunk red panda mascot.
```

The tool accepts only one argument: `prompt`. Grok decides how to satisfy the request.

## X/Twitter usage

`grok_build` can handle common X/Twitter requests in natural language:

```text
Search X for recent reactions to the latest Grok Build release.
Read this X thread and summarize the main points: https://x.com/...
```

For X/Twitter links, Grok Build usually returns richer context such as replies, quoted posts, media details, views, and bookmarks. If you only need the text of a single post, `webfetch` is usually faster and simpler.
