## Development Guidelines

### Entry Point Convention

Each plugin's `src/index.ts` must **default-export** a function matching the `ExtensionAPI` callback signature:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (event, ctx) => {
    /* ... */
  });
  pi.on("tool_call", async (event, ctx) => {
    /* ... */
  });
}
```

Refer to the pi documentation for all supported event types.

### Adding a New Plugin

1. Create a subdirectory under `packages/` using kebab-case naming.
2. Create `package.json` with the `name` field set to `@pi-lab/<name>` and ensure it includes a `build` script.
3. Manage shared dependency versions centrally in the `catalog` section of `pnpm-workspace.yaml`; sub-packages reference them via `catalog:`.
4. Reference `@mariozechner/pi-coding-agent` from the catalog as a devDependency or peerDependency.
5. Entry point is `src/index.ts`; compiled output goes to `dist/`.
6. All new plugin packages that use `tsdown` must inline the internal utils package in `tsdown.config.ts`:

   ```typescript
   import { defineConfig } from "tsdown";

   export default defineConfig({
     entry: "src/index.ts",
     deps: {
       alwaysBundle: ["@pi-lab/utils"],
     },
   });
   ```

   Add `@pi-lab/utils` as a devDependency with `pnpm --filter <pkg-name> add -D @pi-lab/utils@workspace:*` when the package imports it.

### Dependency Management

- Use `pnpm --filter <pkg-name> add <dep>` to add dependencies to a sub-package. **Do not manually edit `package.json`.**
- Install root workspace dependencies with `pnpm add -w <dep>`.

---

## Common Commands

```bash
# Install all dependencies
pnpm install

# Type-check all packages
pnpm typecheck

# Build a single plugin
cd packages/<name>
pnpm build

# Test the compiled output
pi -e ./packages/<name>/dist/index.mjs
```

---

## Notes

- **Type-check first**: run `pnpm typecheck` after any code change to confirm there are no type errors.
- **After adding a new sub-package**, run `pnpm install` from the root to register the workspace link.
- **Plugin API types** are defined by the pi documentation; consult it for available events and `ctx` types.
- **Existing plugins** (e.g. `packages/permissions`) serve as structural references for new plugins.

### Plugin Persistence Paths

Plugins that persist data to disk should store files under `.pi/pi-lab/`:

| Scope  | Path |
|--------|------|
| Global | `~/.pi/agent/pi-lab/` |
| Local  | `<cwd>/.pi/pi-lab/` |
