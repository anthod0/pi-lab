# @pi-lab/env [![NPM Version](https://img.shields.io/npm/v/@pi-lab/env)](https://www.npmjs.com/package/@pi-lab/env)

Load env vars for pi from `settings.json` and `~/.pi/agent/.env`.

If `PI_CODING_AGENT_DIR` is set, global `settings.json`, `.env`, and the legacy
`pi-lab/.env` fallback are read from that directory instead. The examples below
use the default `~/.pi/agent` directory.

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
Project settings are ignored when Pi cannot confirm that the project is trusted.

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

## Reference existing environment variables

String values in the `settings.json` `env` block can reference variables already
present when this extension loads:

```json
{
  "env": {
    "EXA_API_KEY": "${EXA_KEY_PROD}",
    "ANTHROPIC_BASE_URL": "https://${GATEWAY_HOST}/anthropic",
    "HTTP_PROXY": "http://${PROXY_HOST:-127.0.0.1}:7890",
    "LITERAL": "$${EXA_KEY_PROD}"
  }
}
```

- `${VAR}` substitutes the existing value, including an empty string.
- `${VAR:-default}` uses the literal default when the variable is missing or empty.
- `$${VAR}` produces the literal text `${VAR}` without substitution.
- A missing variable without a default stays as `${VAR}` and produces a warning.
  Warnings identify the settings file and variable names, not their values.

Variable names must match `[A-Za-z_][A-Za-z0-9_]*`. Multiple references in a
string are supported. Nested expressions, including references inside defaults,
are not supported and remain literal.

Global and trusted project settings use the same values captured when the
extension loads. Later environment changes do not affect substitutions. Entries
in the same settings block, global settings, and dotenv files loaded by this
extension are not reference sources during that load.

Substitution is text-only: inserted values are not expanded again, and settings
values never execute commands. `$VAR`, shell expressions, and file-reading
expressions are not evaluated. These rules apply only to settings values;
dotenv parsing is unchanged.

## Startup timing

Global `settings.json` env values and `~/.pi/agent/.env` load during extension
initialization, before `session_start`. The legacy `~/.pi/agent/pi-lab/.env`
fallback still works. In the `packages` list, put `@pi-lab/env` before extensions
that read environment variables during import or tool registration.

Trusted project settings load at `session_start`. They override global settings
and dotenv values set by this extension, but cannot change tool registrations
that have already happened. Values inherited from the shell take priority.

If another extension changes or deletes a value set by this loader, later
`session_start` events leave it alone. Reload starts a new factory and leaves
existing process values unchanged.

## Note

- Does not override env vars already set before launching `pi`
- `settings.json` env values take precedence over dotenv values
