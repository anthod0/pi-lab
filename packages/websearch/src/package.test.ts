import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempDisposableSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

for (const name of ["openai", "websearch"]) {
  test(`${name} ships private utils as TS and installs offline without building or publishing utils`, async (t) => {
    const testRoot = mkdtempDisposableSync(join(tmpdir(), `pi-${name}-package-`));
    t.after(() => testRoot.remove());
    const archive = join(testRoot.path, `${name}.tgz`);
    execFileSync("pnpm", ["pack", "--out", archive], {
      cwd: fileURLToPath(new URL(`../../${name}/`, import.meta.url)),
      stdio: "pipe",
      timeout: 30_000,
    });
    const files = execFileSync("tar", ["-tf", archive], { encoding: "utf8" }).trim().split("\n");
    assert.ok(files.includes("package/src/index.ts"));
    assert.ok(files.includes("package/node_modules/@pi-lab/utils/src/index.ts"));
    assert.equal(files.some((path) => path.endsWith(".test.ts") || path.includes("/dist/") || /\.m?js$/.test(path)), false);
    // Only utils is bundled, never Pi's host packages or the companion extension.
    assert.ok(files.filter((path) => path.startsWith("package/node_modules/")).every((path) => path.startsWith("package/node_modules/@pi-lab/utils/")));
    execFileSync("tar", ["-xzf", archive, "-C", testRoot.path]);
    const packageRoot = join(testRoot.path, "package");
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    assert.deepEqual(manifest.pi.extensions, ["./src/index.ts"]);
    assert.deepEqual(manifest.bundledDependencies, ["@pi-lab/utils"]);
    const utils = JSON.parse(readFileSync(join(packageRoot, "node_modules/@pi-lab/utils/package.json"), "utf8"));
    assert.equal(utils.private, true);
    assert.equal(utils.exports["."], "./src/index.ts");

    async function assertLoads(path: string) {
      const result = await discoverAndLoadExtensions([path], testRoot.path, join(testRoot.path, "agent"));
      assert.deepEqual(result.errors, []);
      assert.equal(result.extensions.length, 1);
      assert.ok(result.extensions[0].handlers.has("session_start"));
    }
    await assertLoads(packageRoot);

    const consumer = join(testRoot.path, "consumer");
    mkdirSync(consumer);
    writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "package-test", private: true }));
    const userConfig = join(testRoot.path, "npmrc");
    const globalConfig = join(testRoot.path, "global-npmrc");
    writeFileSync(userConfig, "");
    writeFileSync(globalConfig, "");
    // Pi provides host peer dependencies at load time. An empty cache plus offline
    // installation proves that utils does not need to exist on the registry.
    execFileSync("npm", [
      "install", archive, "--offline", "--ignore-scripts", "--legacy-peer-deps", "--no-audit", "--no-fund",
      "--cache", join(testRoot.path, "npm-cache"), "--userconfig", userConfig, "--globalconfig", globalConfig,
    ], { cwd: consumer, stdio: "pipe", timeout: 30_000 });
    await assertLoads(join(consumer, "node_modules", "@pi-lab", name));
  });
}
