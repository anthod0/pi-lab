# @pi-lab/grok-build

A pi extension that adds a single `grok_build` tool backed by the local [Grok Build](https://docs.x.ai/build/overview) CLI.

## Requirements

Install and authenticate `Grok Build` first.

## Capability guidance

| Capability       | Guidance                                                        |
| ---------------- | --------------------------------------------------------------- |
| Image generation | ✅ Recommended                                                  |
| Image edit       | ✅ Recommended                                                  |
| Video generation | ✅ Recommended                                                  |
| Web search       | ⚠️ Available but not recommended; prefer other `websearch` tool |
| Web fetch        | ⚠️ Available but not recommended; prefer other `webfetch` tool  |
| Coding tasks     | ❌ Not Recommended                                              |

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
