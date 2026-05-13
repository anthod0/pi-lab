# @pi-lab/env [![NPM Version](https://img.shields.io/npm/v/@pi-lab/env)](https://www.npmjs.com/package/@pi-lab/env)

Load global env vars for pi from `~/.pi/agent/.env`.

## Install

```bash
pi install npm:@pi-lab/env
```

## Usage

Create:

```bash
~/.pi/agent/.env
```

Example:

```dotenv
HTTP_PROXY=http://127.0.0.1:7890
HTTPS_PROXY=http://127.0.0.1:7890
OPENAI_API_KEY=...
INTERNAL_TOKEN=...
```

Restart `pi` after editing the file.

## Note

- Does not override env vars already set before launching `pi`
