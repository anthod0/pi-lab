import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempDisposableSync, readFileSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

for (const name of ["env", "webfetch"]) {
  test(`${name} ships loadable TS with private utils and without build output`, (t) => {
    const testRoot = mkdtempDisposableSync(join(tmpdir(), `pi-${name}-package-`));
    t.after(() => testRoot.remove());
    const sourceRoot = fileURLToPath(new URL(`../../${name}/`, import.meta.url));
    const archive = join(testRoot.path, `${name}.tgz`);
    execFileSync("pnpm", ["pack", "--out", archive], {
      cwd: sourceRoot,
      stdio: "pipe",
      timeout: 30_000,
    });
    const files = execFileSync("tar", ["-tf", archive], { encoding: "utf8" }).trim().split("\n");
    assert.ok(files.includes("package/src/index.ts"));
    assert.ok(files.includes("package/node_modules/@pi-lab/utils/src/index.ts"));
    assert.equal(files.some((path) => path.endsWith(".test.ts") || path.includes("/dist/") || /\.m?js$/.test(path)), false);
    assert.ok(files.filter((path) => path.startsWith("package/node_modules/"))
      .every((path) => path.startsWith("package/node_modules/@pi-lab/utils/")));

    execFileSync("tar", ["-xzf", archive, "-C", testRoot.path]);
    const packageRoot = join(testRoot.path, "package");
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    assert.deepEqual(manifest.pi.extensions, ["./src/index.ts"]);
    assert.deepEqual(manifest.bundledDependencies, ["@pi-lab/utils"]);
    assert.equal(manifest.dependencies["@pi-lab/utils"], "0.0.0");

    // Supply installed third-party runtime dependencies without network access.
    // Utils must resolve from the archive, and Pi supplies its own host packages.
    for (const dependency of Object.keys(manifest.dependencies)) {
      if (dependency === "@pi-lab/utils") continue;
      const destination = join(packageRoot, "node_modules", dependency);
      mkdirSync(dirname(destination), { recursive: true });
      symlinkSync(realpathSync(join(sourceRoot, "node_modules", dependency)), destination, "dir");
    }

    // Env runs during factory initialization, so isolate both settings and env
    // changes in a child process with an explicit agent directory.
    execFileSync(process.execPath, ["--input-type=module", "--eval", `
      import assert from "node:assert/strict";
      import { discoverAndLoadExtensions } from ${JSON.stringify(import.meta.resolve("@earendil-works/pi-coding-agent"))};
      const result = await discoverAndLoadExtensions(
        [${JSON.stringify(packageRoot)}], process.cwd(), process.env.PI_CODING_AGENT_DIR,
      );
      assert.deepEqual(result.errors, []);
      assert.equal(result.extensions.length, 1);
      if (${JSON.stringify(name)} === "env") {
        assert.ok(result.extensions[0].handlers.has("session_start"));
      } else {
        assert.ok(result.extensions[0].tools.has("webfetch"));
      }
    `], {
      cwd: testRoot.path,
      env: { ...process.env, PI_CODING_AGENT_DIR: join(testRoot.path, "agent") },
      stdio: "pipe",
      timeout: 30_000,
    });
  });
}
