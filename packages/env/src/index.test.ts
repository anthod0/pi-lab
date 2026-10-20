import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, parse, sep } from "node:path";
import test from "node:test";

interface Scenario {
  dotenv?: string;
  dotenvDirectory?: boolean;
  legacy?: boolean;
  globalEnv?: Record<string, string>;
  globalContent?: string;
  projectEnv?: Record<string, string>;
  projectContent?: string;
  trusted?: boolean;
  inherited?: Record<string, string>;
  changedAfterLoad?: Record<string, string>;
  deletedAfterLoad?: string[];
  repeat?: boolean;
  changedAfterSession?: Record<string, string>;
  deletedAfterSession?: string[];
  reload?: boolean;
}

const keys = ["NEW_VALUE", "SHARED", "FILE_ONLY", "PROJECT_ONLY"];
type Snapshot = Record<string, string | null>;

function runScenario(scenario: Scenario = {}) {
  const tempDir = realpathSync(tmpdir());
  const realHome = realpathSync(homedir());
  const root = mkdtempSync(join(tempDir, "pi-env-startup-"));
  try {
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    if (scenario.dotenvDirectory) {
      mkdirSync(join(agentDir, ".env"));
    } else if (scenario.dotenv !== undefined) {
      const envDir = scenario.legacy ? join(agentDir, "pi-lab") : agentDir;
      mkdirSync(envDir, { recursive: true });
      writeFileSync(join(envDir, ".env"), scenario.dotenv, "utf8");
    }
    writeFileSync(
      join(agentDir, "settings.json"),
      scenario.globalContent ?? JSON.stringify({ env: scenario.globalEnv ?? {} }),
      "utf8",
    );
    writeFileSync(
      join(cwd, ".pi", "settings.json"),
      scenario.projectContent ?? JSON.stringify({ env: scenario.projectEnv ?? {} }),
      "utf8",
    );
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of keys) delete env[key];
    Object.assign(env, scenario.inherited);

    const child = spawnSync(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        "--input-type=module",
        "--eval",
        `
          const moduleUrl = ${JSON.stringify(new URL("./index.ts", import.meta.url).href)};
          const { default: initialize } = await import(moduleUrl);
          const paths = ${JSON.stringify({ agentDir, envFile: join(agentDir, ".env") })};
          const snapshot = () => Object.fromEntries(${JSON.stringify(keys)}.map(key => [key, process.env[key] ?? null]));
          const before = snapshot();
          let sessionStart;
          let factoryError = null;
          const api = { on: (name, handler) => { if (name === "session_start") sessionStart = handler; } };
          try { initialize(api, paths); } catch (error) { factoryError = error.message; }
          const early = snapshot();
          Object.assign(process.env, ${JSON.stringify(scenario.changedAfterLoad ?? {})});
          for (const key of ${JSON.stringify(scenario.deletedAfterLoad ?? [])}) delete process.env[key];
          const ctx = { cwd: process.cwd(), isProjectTrusted: () => ${scenario.trusted ?? true} };
          if (sessionStart) await sessionStart({}, ctx);
          const session = snapshot();
          Object.assign(process.env, ${JSON.stringify(scenario.changedAfterSession ?? {})});
          for (const key of ${JSON.stringify(scenario.deletedAfterSession ?? [])}) delete process.env[key];
          if (${scenario.repeat ?? false}) await sessionStart({}, ctx);
          const repeated = snapshot();
          if (${scenario.reload ?? false}) {
            // Pi may return a cached factory or freshly evaluate its module.
            const { default: reinitialize } = await import(moduleUrl + "?reload");
            reinitialize(api, paths);
            await sessionStart({}, ctx);
          }
          console.log(JSON.stringify({ before, early, session, repeated, reloaded: snapshot(), factoryError, registered: !!sessionStart }));
        `,
      ],
      { cwd, env, encoding: "utf8", timeout: 30_000 },
    );
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout) as {
      before: Snapshot;
      early: Snapshot;
      session: Snapshot;
      repeated: Snapshot;
      reloaded: Snapshot;
      factoryError: string | null;
      registered: boolean;
    };
  } finally {
    // Only remove the exact mkdtemp result, never a home or an ancestor of it.
    assert.ok(root.startsWith(join(tempDir, "pi-env-startup-")));
    assert.notEqual(root, parse(root).root);
    assert.notEqual(root, realHome);
    assert.ok(!realHome.startsWith(`${root}${sep}`));
    rmSync(root, { recursive: true, force: true });
  }
}

for (const legacy of [false, true]) {
  test(`factory loads ${legacy ? "legacy" : "global"} dotenv during initialization`, () => {
    const result = runScenario({
      dotenv: "NEW_VALUE=from-file # inline comment\n",
      legacy,
    });
    assert.equal(result.before.NEW_VALUE, null);
    assert.equal(result.early.NEW_VALUE, "from-file");
    assert.equal(result.session.NEW_VALUE, "from-file");
  });
}

test("factory loads global settings before dotenv during initialization", () => {
  const result = runScenario({
    dotenv: "NEW_VALUE=from-file\nSHARED=file\n",
    globalEnv: { NEW_VALUE: "from-settings", SHARED: "global" },
  });
  assert.equal(result.early.NEW_VALUE, "from-settings");
  assert.equal(result.early.SHARED, "global");
  assert.equal(result.session.NEW_VALUE, "from-settings");
  assert.equal(result.session.SHARED, "global");
});

test("trusted project settings override early globals and dotenv at session_start only", () => {
  const result = runScenario({
    dotenv: "SHARED=file\nFILE_ONLY=file\n",
    globalEnv: { SHARED: "global" },
    projectEnv: { SHARED: "project", FILE_ONLY: "", PROJECT_ONLY: "project" },
  });
  assert.equal(result.early.SHARED, "global");
  assert.equal(result.early.FILE_ONLY, "file");
  assert.equal(result.early.PROJECT_ONLY, null);
  assert.equal(result.session.SHARED, "project");
  assert.equal(result.session.FILE_ONLY, "");
  assert.equal(result.session.PROJECT_ONLY, "project");
});

test("untrusted project settings are never read, including during factory initialization", () => {
  const result = runScenario({
    dotenv: "FILE_ONLY=file\n",
    globalEnv: { SHARED: "global" },
    projectContent: "not valid JSON",
    trusted: false,
  });
  assert.equal(result.early.SHARED, "global");
  assert.equal(result.session.SHARED, "global");
  assert.equal(result.session.FILE_ONLY, "file");
  assert.equal(result.session.PROJECT_ONLY, null);
});

test("shell values, including empty and identical values, keep precedence", () => {
  const result = runScenario({
    dotenv: "NEW_VALUE=from-file\nFILE_ONLY=file\n",
    globalEnv: { SHARED: "global" },
    projectEnv: { NEW_VALUE: "from-settings", SHARED: "project", FILE_ONLY: "project" },
    inherited: { NEW_VALUE: "from-shell", SHARED: "global", FILE_ONLY: "" },
  });
  assert.equal(result.session.NEW_VALUE, "from-shell");
  assert.equal(result.session.SHARED, "global");
  assert.equal(result.session.FILE_ONLY, "");
});

test("later extension changes are not overwritten by project settings", () => {
  const result = runScenario({
    dotenv: "FILE_ONLY=file\n",
    globalEnv: { SHARED: "global" },
    projectEnv: { SHARED: "project", FILE_ONLY: "project" },
    changedAfterLoad: { SHARED: "extension", FILE_ONLY: "" },
  });
  assert.equal(result.session.SHARED, "extension");
  assert.equal(result.session.FILE_ONLY, "");
});

for (const trusted of [false, true]) {
  test(`later deletions are not refilled from settings or dotenv (${trusted ? "trusted" : "untrusted"} project)`, () => {
    const result = runScenario({
      dotenv: "FILE_ONLY=file\n",
      globalEnv: { SHARED: "global" },
      projectEnv: { SHARED: "project", FILE_ONLY: "project" },
      deletedAfterLoad: ["SHARED", "FILE_ONLY"],
      trusted,
    });
    assert.equal(result.early.SHARED, "global");
    assert.equal(result.early.FILE_ONLY, "file");
    assert.equal(result.session.SHARED, null);
    assert.equal(result.session.FILE_ONLY, null);
  });
}

test("repeated session_start events preserve injected project values", () => {
  const result = runScenario({
    dotenv: "FILE_ONLY=file\n",
    globalEnv: { SHARED: "global" },
    projectEnv: { SHARED: "project", FILE_ONLY: "project", PROJECT_ONLY: "project" },
    repeat: true,
  });
  assert.equal(result.session.SHARED, "project");
  assert.deepEqual(result.repeated, result.session);
});

test("repeated events preserve changes and deletions of session-injected values", () => {
  const result = runScenario({
    dotenv: "FILE_ONLY=file\n",
    globalEnv: { SHARED: "global" },
    projectEnv: { SHARED: "project", FILE_ONLY: "project", PROJECT_ONLY: "project" },
    changedAfterSession: { SHARED: "global" },
    deletedAfterSession: ["FILE_ONLY", "PROJECT_ONLY"],
    repeat: true,
  });
  assert.equal(result.session.SHARED, "project");
  assert.equal(result.repeated.SHARED, "global");
  assert.equal(result.repeated.FILE_ONLY, null);
  assert.equal(result.repeated.PROJECT_ONLY, null);
});

for (const mutation of ["change", "delete"] as const) {
  test(`repeated events do not reclaim a value restored after an external ${mutation}`, () => {
    const result = runScenario({
      globalEnv: { SHARED: "global" },
      projectEnv: { SHARED: "project" },
      changedAfterLoad: mutation === "change" ? { SHARED: "extension" } : {},
      deletedAfterLoad: mutation === "delete" ? ["SHARED"] : [],
      changedAfterSession: { SHARED: "global" },
      repeat: true,
    });
    assert.equal(result.early.SHARED, "global");
    assert.equal(result.session.SHARED, mutation === "change" ? "extension" : null);
    assert.equal(result.repeated.SHARED, "global");
  });
}

test("repeated events do not refill a relinquished value after another extension deletes it", () => {
  const result = runScenario({
    globalEnv: { SHARED: "global" },
    projectEnv: { SHARED: "project" },
    changedAfterLoad: { SHARED: "extension" },
    deletedAfterSession: ["SHARED"],
    repeat: true,
  });
  assert.equal(result.session.SHARED, "extension");
  assert.equal(result.repeated.SHARED, null);
});

test("fresh factory evaluation on reload preserves existing process values", () => {
  const result = runScenario({
    dotenv: "FILE_ONLY=file\n",
    globalEnv: { SHARED: "global" },
    projectEnv: { SHARED: "project", FILE_ONLY: "project" },
    inherited: { SHARED: "from-shell" },
    changedAfterSession: { FILE_ONLY: "extension" },
    reload: true,
  });
  assert.equal(result.reloaded.SHARED, "from-shell");
  assert.equal(result.reloaded.FILE_ONLY, "extension");
});

test("invalid global settings fail initialization without injecting values", () => {
  const result = runScenario({
    globalContent: "not valid JSON",
    dotenv: "FILE_ONLY=file\n",
  });
  assert.notEqual(result.factoryError, null);
  assert.equal(result.registered, false);
  assert.deepEqual(result.early, result.before);
});

test("dotenv read failures do not partially inject global settings", () => {
  const result = runScenario({
    dotenvDirectory: true,
    globalEnv: { SHARED: "global" },
  });
  assert.match(result.factoryError ?? "", /Failed to load ~\/\.pi\/agent\/\.env/);
  assert.equal(result.registered, false);
  assert.deepEqual(result.early, result.before);
});

test("missing dotenv and env settings do not inject values", () => {
  const result = runScenario();
  assert.equal(result.factoryError, null);
  assert.equal(result.registered, true);
  for (const key of keys) {
    assert.equal(result.early[key], null);
    assert.equal(result.session[key], null);
  }
});
