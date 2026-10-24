# pi-lab

A collection of [pi coding agent](https://github.com/earendil-works/pi) extensions, packaged for `pi install`.

## Packages

| Package                                           | Description                                                             | Version                                                                                                                   |
| ------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [@pi-lab/openai](./packages/openai)               | OpenAI ChatGPT Fast controls and native Web Search                     | [![NPM Version](https://img.shields.io/npm/v/@pi-lab/openai)](https://www.npmjs.com/package/@pi-lab/openai) |
| [@pi-lab/codex-image](./packages/codex-image)       | Generate and edit images using local Codex CLI                          | [![NPM Version](https://img.shields.io/npm/v/@pi-lab/codex-image)](https://www.npmjs.com/package/@pi-lab/codex-image) |
| [@pi-lab/permissions](./packages/permissions)     | Permission system — enforce allow / deny / ask rules on tool calls      | [![NPM Version](https://img.shields.io/npm/v/@pi-lab/permissions)](https://www.npmjs.com/package/@pi-lab/permissions)     |
| [@pi-lab/webfetch](./packages/webfetch)           | Fetch URLs as clean Markdown with X/Twitter and Reddit optimizations     | [![NPM Version](https://img.shields.io/npm/v/@pi-lab/webfetch)](https://www.npmjs.com/package/@pi-lab/webfetch)           |
| [@pi-lab/websearch](./packages/websearch)         | Search the web with Exa, Parallel, or TinyFish                          | [![NPM Version](https://img.shields.io/npm/v/@pi-lab/websearch)](https://www.npmjs.com/package/@pi-lab/websearch)         |
| [@pi-lab/env](./packages/env)                     | Load `.env` into pi sessions                                            | [![NPM Version](https://img.shields.io/npm/v/@pi-lab/env)](https://www.npmjs.com/package/@pi-lab/env)                     |
| [@pi-lab/ssm-env](./packages/ssm-env)             | Load environment variables from AWS SSM Parameter Store                 | [![NPM Version](https://img.shields.io/npm/v/@pi-lab/ssm-env)](https://www.npmjs.com/package/@pi-lab/ssm-env)             |
| [@pi-lab/input-history](./packages/input-history) | `↑` recalls inputs across all sessions in the same project              | [![NPM Version](https://img.shields.io/npm/v/@pi-lab/input-history)](https://www.npmjs.com/package/@pi-lab/input-history) |
| [@pi-lab/notify](./packages/notify)               | Desktop notifications                                                   | [![NPM Version](https://img.shields.io/npm/v/@pi-lab/notify)](https://www.npmjs.com/package/@pi-lab/notify)               |
| [@pi-lab/subagent](./packages/subagent)           | A minimal synchronous subagent                                           | [![NPM Version](https://img.shields.io/npm/v/@pi-lab/subagent)](https://www.npmjs.com/package/@pi-lab/subagent)           |

### Archived packages

These packages are no longer maintained and are retained for reference. No further updates or fixes are planned.

| Package | Reason | Version |
| ------- | -------------------- | ------- |
| [@pi-lab/grok-build](./packages/grok-build) |  Just using the Grok CLI directly. | [![NPM Version](https://img.shields.io/npm/v/@pi-lab/grok-build)](https://www.npmjs.com/package/@pi-lab/grok-build) |
| [@pi-lab/xsearch](./packages/xsearch) | Parallel and TinyFish can find some X posts; for more time-sensitive searches, use Grok directly. | [![NPM Version](https://img.shields.io/npm/v/@pi-lab/xsearch)](https://www.npmjs.com/package/@pi-lab/xsearch) |

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

```

For packages that publish compiled output:

```bash
cd packages/<name>
pnpm build
pi -e ./dist/index.mjs
```

### TypeScript source packages

`openai` and `websearch` publish `src/index.ts` directly. Their `build` scripts only type-check; they do not produce `dist` files. Each package uses standard `bundledDependencies` to include the private `@pi-lab/utils` TypeScript source, so utils is maintained once but never needs a separate npm release. Tests are excluded from both the extension and bundled utils.

The workspace uses `nodeLinker: hoisted`, which pnpm requires for this packaging mode. Run `pnpm install` after updating the workspace configuration; installation and packing must use the same layout. Pi's host packages remain peer dependencies and are not bundled. The release workflow skips private packages.

Packaging regression tests pack both source extensions, install their tarballs offline outside the workspace, and load them through Pi:

```bash
pnpm --filter @pi-lab/websearch test
```
