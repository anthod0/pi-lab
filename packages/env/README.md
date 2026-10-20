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
