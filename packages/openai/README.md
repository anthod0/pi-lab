# @pi-lab/openai

Image generation and editing through Codex or the OpenAI API, plus Fast mode, latency optimization and native web search for Pi.

## Install and configure

```bash
pi install npm:@pi-lab/openai
```

Add the following to `~/.pi/agent/settings.json` (global) or `.pi/settings.json` (project), preserving existing settings, then run `/reload`:

```json
{
  "openai": {
    "fast": false,
    "optimizeLatency": true,
    "webSearch": true,
    "imageGeneration": { "backend": "codex" }
  }
}
```

All features are disabled by default. Project settings override global values; only trusted projects can override image configuration, which is replaced as a whole.

## Features

### Image generation

Adds the `generate_image` tool for image generation and editing with OpenAI models, including the GPT Image 2, 2.5 and 2.6 families.

Two backends are available: Codex and the OpenAI API. The Codex backend only supports `gpt-image-2`.

#### Configuration

Choose one of the following configurations:

```json
{
  "openai": {
    "imageGeneration": { "backend": "codex" }
  }
}
```

```json
{
  "openai": {
    "imageGeneration": { "backend": "openai", "model": "gpt-image-2" }
  }
}
```

Set `imageGeneration` to `false` to disable images. Disable `@pi-lab/codex-image` before enabling this feature, since both register `generate_image`.

#### Credentials

- **Codex:** `/login` → **OpenAI Codex (legacy)**. Uses account quota.
- **OpenAI API:** `OPENAI_API_KEY`, or an OpenAI API key configured in Pi. The environment key takes precedence. Uses the official API endpoint and API billing.

### Fast mode

Request Fast processing for chat. `/fast` toggles it; `/fast on`, `/fast off` and `/fast status` are also available. Command changes persist in the session; new sessions use settings.

#### Configuration

```json
{
  "openai": {
    "fast": true
  }
}
```

#### Credentials

**OpenAI → Sign in with ChatGPT**, with an `openai` chat model. Inactive when using `openai-codex` or API keys.

### Web search

Enables native web search when using an `openai` chat model.

When `@pi-lab/websearch` is also installed, native search takes precedence on supported connections; other connections use `@pi-lab/websearch`.

#### Configuration

```json
{
  "openai": {
    "webSearch": true
  }
}
```

#### Credentials

**OpenAI → Sign in with ChatGPT**, with an `openai` chat model. Inactive when using `openai-codex` or API keys.

### Latency optimization

Set `openai.optimizeLatency` to `true` and run `/reload` to reduce repeated history uploads and help lower request latency in long conversations. Applies to **OpenAI → Sign in with ChatGPT** chat models.

Fast mode requests priority processing; latency optimization reduces the amount of context uploaded. Both can be enabled together, alongside native web search.

```json
{
  "openai": {
    "optimizeLatency": true
  }
}
```

Disabled by default. API keys and custom endpoints continue using HTTP. When continuation is unavailable, requests send the full conversation automatically. If a WebSocket connection cannot be established, the session uses HTTP until `/reload` or a new session.
