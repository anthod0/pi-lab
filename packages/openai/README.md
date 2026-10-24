# @pi-lab/openai

Fast mode controls and native web search for Pi's **OpenAI → Sign in with ChatGPT** connection.

## Install

```bash
pi install npm:@pi-lab/openai
```

Run `/reload`, select an `openai` model, and log in with **Sign in with ChatGPT**. API keys, `openai-codex`, and custom API endpoints are not supported by this extension.

## Configure

Add an `openai` section to `~/.pi/agent/settings.json` (global) or `.pi/settings.json` (project), preserving any existing settings:

```json
{
  "openai": {
    "fast": false,
    "webSearch": true
  }
}
```

Both options default to `false`. Project values override individual global values. Run `/reload` after editing the file.

## Fast mode

| Command | Effect |
| --- | --- |
| `/fast` | Toggle Fast mode |
| `/fast on` | Request Fast processing |
| `/fast off` | Stop requesting Fast processing |
| `/fast status` | Show the current setting |

When enabled, requests send `service_tier: "priority"`; when disabled, the field is omitted. Commands affect the next request and are saved in the session, not in `settings.json`. A new session uses the file configuration.

The status bar shows `fast` in the footer's theme color only when Fast is enabled for a supported connection. Otherwise, no status is shown. Use `/fast status` to inspect the setting.

**Fast availability through Sign in with ChatGPT is not verified.** Enabling it requests Fast processing but does not guarantee faster responses or account eligibility. If the server rejects it, use `/fast off` and retry.

## Web search

Set `webSearch` to `true`, then ask Pi to search the web. The model decides when to search. Search activity does not appear in the status bar. Source links supplied by OpenAI are added when the answer finishes and saved with the conversation.

Availability depends on the model and account policy. No separate search API key is needed.

### Using with @pi-lab/websearch

If both extensions are installed, `@pi-lab/websearch` yields to native search when it is enabled for a supported ChatGPT connection. Other connections, or disabling native search, make standalone search available instead.

If you remove this extension, also set `openai.webSearch` to `false` and run `/reload`. Native search errors do not automatically fall back to standalone search.
