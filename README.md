# pi-lab

A collection of [pi coding agent](https://github.com/earendil-works/pi) extensions, packaged for `pi install`.

## Packages

| Package                                           | Description                                                             | Version                                                                                                                   |
| ------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [@pi-lab/permissions](./packages/permissions)     | Permission system — enforce allow / deny / ask rules on tool calls      | [![NPM Version](https://img.shields.io/npm/v/@pi-lab/permissions)](https://www.npmjs.com/package/@pi-lab/permissions)     |
| [@pi-lab/webfetch](./packages/webfetch)           | Fetch URL and get clean Markdown; includes Reddit/X fetch optimizations | [![NPM Version](https://img.shields.io/npm/v/@pi-lab/webfetch)](https://www.npmjs.com/package/@pi-lab/webfetch)           |
| [@pi-lab/websearch](./packages/websearch)         | Search the web with Exa                                                 | [![NPM Version](https://img.shields.io/npm/v/@pi-lab/websearch)](https://www.npmjs.com/package/@pi-lab/websearch)         |
| [@pi-lab/xsearch](./packages/xsearch)             | Search X/Twitter with xAI Grok and citation URLs                        | [![NPM Version](https://img.shields.io/npm/v/@pi-lab/xsearch)](https://www.npmjs.com/package/@pi-lab/xsearch)             |
| [@pi-lab/grok-build](./packages/grok-build)       | Use local Grok Build for image/video generation                         | [![NPM Version](https://img.shields.io/npm/v/@pi-lab/grok-build)](https://www.npmjs.com/package/@pi-lab/grok-build)       |
| [@pi-lab/env](./packages/env)                     | Load `.env` into pi sessions                                            | [![NPM Version](https://img.shields.io/npm/v/@pi-lab/env)](https://www.npmjs.com/package/@pi-lab/env)                     |
| [@pi-lab/input-history](./packages/input-history) | `↑` recalls inputs across all sessions in the same project              | [![NPM Version](https://img.shields.io/npm/v/@pi-lab/input-history)](https://www.npmjs.com/package/@pi-lab/input-history) |
| [@pi-lab/notify](./packages/notify)               | Desktop notifications                                                   | [![NPM Version](https://img.shields.io/npm/v/@pi-lab/notify)](https://www.npmjs.com/package/@pi-lab/notify)               |

## Install

Each package can be installed individually:

```bash
pi install npm:@pi-lab/permissions
```

Or pin to a git ref:

```bash
pi install git:github.com/anthod0/pi-lab@main
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
