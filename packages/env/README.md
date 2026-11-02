# @pi-lab/env [![NPM Version](https://img.shields.io/npm/v/@pi-lab/env)](https://www.npmjs.com/package/@pi-lab/env)

Load environment variables for pi from settings and dotenv files.

## Install

```bash
pi install npm:@pi-lab/env
```

## Usage

Add an `env` block to `~/.pi/agent/settings.json`:

```json
{
  "env": {
    "OPENAI_API_KEY": "${OPENAI_KEY_PROD}",
    "ANTHROPIC_BASE_URL": "https://${GATEWAY_HOST}/anthropic",
    "HTTP_PROXY": "http://${PROXY_HOST:-127.0.0.1}:7890"
  }
}
```

You can also use `~/.pi/agent/.env`. The legacy `~/.pi/agent/pi-lab/.env`
location is used when `.env` is absent. Set `PI_CODING_AGENT_DIR` to use a
different agent directory for all global files.

Trusted projects can add or override values in `.pi/settings.json`. Project
settings are ignored unless Pi confirms trust. Restart pi after editing files.

## Variable references

In settings values:

- `${VAR}` uses an existing environment variable. If missing, it stays literal and warns without logging values.
- `${VAR:-default}` uses the literal default when the variable is missing or empty.
- `$${VAR}` produces the literal text `${VAR}`.

References use environment values present when this extension loads, not values
it subsequently loads from settings or dotenv. Variable names must match
`[A-Za-z_][A-Za-z0-9_]*`. No nested expressions, recursive expansion, or command
execution. Dotenv parsing is unchanged.

## Loading and precedence

Existing environment variables take priority, followed by trusted project
settings, global settings, then dotenv. Values changed or deleted by another
extension are left alone.

Put `@pi-lab/env` before packages that need these variables during startup.
Global values load early; project values load when the session starts and cannot
change tools already registered. Reload preserves existing process values.
