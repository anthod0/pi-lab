# pi-lab

> This is a personal collection of extensions for [pi coding agent](https://github.com/badlogic/pi-mono). For the official repository, see [badlogic/pi-mono](https://github.com/badlogic/pi-mono).

A collection of [pi coding agent](https://github.com/badlogic/pi-mono) extensions, packaged for `pi install`.

## Packages

| Package                                           | Description                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| [@pi-lab/permissions](./packages/permissions)     | Permission system — enforce allow / deny / ask rules on tool calls |
| [@pi-lab/webfetch](./packages/webfetch)           | Fetch URL and get clean Markdown                                   |
| [@pi-lab/websearch](./packages/websearch)         | Search the web with Exa                                            |
| [@pi-lab/xsearch](./packages/xsearch)             | Search X/Twitter with xAI Grok and citation URLs                   |
| [@pi-lab/env](./packages/env)                     | Load `.env` into pi sessions                                       |
| [@pi-lab/input-history](./packages/input-history) | `↑` recalls inputs across all sessions in the same project         |

## Install

Each package can be installed individually:

```bash
pi install npm:@pi-lab/permissions
```

Or pin to a git ref:

```bash
pi install git:github.com/ocherry341/pi-lab@main
```

## Development

```bash
pnpm install

# type-check all packages
pnpm typecheck

# test an extension locally without installing
pi -e ./packages/<name>/src/index.ts

# test the compiled output
cd packages/<name>
pnpm build
pi -e ./dist/index.mjs
```
