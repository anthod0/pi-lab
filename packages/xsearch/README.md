# @pi-lab/xsearch

A pi extension that adds an `xsearch` tool powered by xAI Grok `x_search`.

## Install

```bash
pi install npm:@pi-lab/xsearch
```

## Usage

Set your xAI API key before starting `pi`:

```bash
export XAI_API_KEY=<your-api-key>
pi
```

You can also provide `XAI_API_KEY` through `@pi-lab/env`.

Once installed and configured, ask pi to search X/Twitter. For example:

```text
Search X for what people are saying about the latest Grok release.
```

The tool returns Grok's answer plus X citation URLs. It is not a raw tweet API and does not guarantee original post objects.

## Settings

Configure behavior in pi settings. User settings live at `~/.pi/agent/settings.json`; project settings live at `<cwd>/.pi/settings.json`. Project settings override user settings.

```json
{
  "xsearch": {
    "model": "grok-4-1-fast-non-reasoning",
    "enableImageUnderstanding": false,
    "enableVideoUnderstanding": false
  }
}
```

Defaults:

- `model`: `grok-4-1-fast-non-reasoning`
- `enableImageUnderstanding`: `false`
- `enableVideoUnderstanding`: `false`

See the official xAI docs when choosing a model and estimating cost:

- [xAI models](https://docs.x.ai/docs/models) — available models, pricing, and tool costs.
- [xAI X Search](https://docs.x.ai/developers/tools/x-search) — supported `x_search` behavior and parameters.

For most routine searches, use a fast/non-reasoning model such as `grok-4-1-fast-non-reasoning`. Use a stronger reasoning model only when you need deeper synthesis, since model choice affects latency and token cost. Media understanding can add extra cost, so it defaults to disabled.
