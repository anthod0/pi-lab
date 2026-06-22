# @pi-lab/env [![NPM Version](https://img.shields.io/npm/v/@pi-lab/env)](https://www.npmjs.com/package/@pi-lab/env)

Load env vars for pi from `settings.json` and `~/.pi/agent/.env`.

## Install

```bash
pi install npm:@pi-lab/env
```

## Usage

Configure env vars in global settings:

```json
// ~/.pi/agent/settings.json
{
  "env": {
    "HTTP_PROXY": "http://127.0.0.1:7890",
    "HTTPS_PROXY": "http://127.0.0.1:7890",
    "OPENAI_API_KEY": "...",
    "INTERNAL_TOKEN": "..."
  }
}
```

Trusted projects can also override/add env vars in `.pi/settings.json` with the same `env` shape.

You can still use a dotenv file:

```bash
~/.pi/agent/.env
```

```dotenv
HTTP_PROXY=http://127.0.0.1:7890
HTTPS_PROXY=http://127.0.0.1:7890
OPENAI_API_KEY=...
INTERNAL_TOKEN=...
```

Restart `pi` after editing settings or dotenv files.

## Note

- Does not override env vars already set before launching `pi`
- `settings.json` env values take precedence over dotenv values
