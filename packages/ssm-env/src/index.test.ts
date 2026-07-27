import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { registerSsmEnvExtension, type ManagedSsmEnvState } from "./index";

function setup(
  config: unknown,
  options: {
    target?: NodeJS.ProcessEnv;
    responses?: Array<Record<string, string>>;
    error?: Error;
  } = {},
) {
  const home = mkdtempSync(join(tmpdir(), "pi-ssm-env-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "pi-ssm-env-cwd-"));
  const agentDir = join(home, ".pi", "agent");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify(config), "utf8");

  let sessionStart: ((event: unknown, ctx: any) => Promise<void>) | undefined;
  const warnings: string[] = [];
  const requestedNames: string[][] = [];
  let destroyed = 0;
  let requestIndex = 0;
  const target = options.target ?? {};
  const state: ManagedSsmEnvState = {
    originalValues: new Map(),
    managedKeys: new Set(),
  };

  const pi = {
    on(name: string, handler: (event: unknown, ctx: any) => Promise<void>) {
      if (name === "session_start") sessionStart = handler;
    },
  };

  registerSsmEnvExtension(pi as any, {
    agentDir,
    target,
    state,
    warn(message) {
      warnings.push(message);
    },
    createClient() {
      return {
        async send(command: any) {
          if (options.error) throw options.error;
          const names = command.input.Names as string[];
          requestedNames.push(names);
          const response = options.responses?.[requestIndex++] ?? {};
          return {
            $metadata: {},
            Parameters: names.flatMap((Name) =>
              response[Name] === undefined ? [] : [{ Name, Value: response[Name] }],
            ),
          };
        },
        destroy() {
          destroyed += 1;
        },
      };
    },
  });

  return {
    target,
    warnings,
    requestedNames,
    get destroyed() {
      return destroyed;
    },
    async start() {
      assert.ok(sessionStart);
      await sessionStart(
        { type: "session_start" },
        {
          cwd,
          hasUI: false,
          isProjectTrusted: () => true,
        },
      );
    },
  };
}

test("session_start loads explicitly mapped SSM parameters without overriding env", async () => {
  const app = setup(
    {
      ssmEnv: {
        profile: "company-dev",
        region: "ap-southeast-1",
        parameters: {
          DATABASE_URL: "/service/dev/database-url",
          EXISTING: "/service/dev/existing",
        },
      },
    },
    {
      target: { EXISTING: "from-shell" },
      responses: [
        {
          "/service/dev/database-url": "from-ssm",
          "/service/dev/existing": "remote-existing",
        },
      ],
    },
  );

  await app.start();

  assert.equal(app.target.DATABASE_URL, "from-ssm");
  assert.equal(app.target.EXISTING, "from-shell");
  assert.deepEqual(app.warnings, []);
  assert.equal(app.destroyed, 1);
});

test("session_start warns about missing parameters but loads values that exist", async () => {
  const app = setup(
    {
      ssmEnv: {
        parameters: {
          PRESENT: "/present",
          MISSING: "/missing",
        },
      },
    },
    { responses: [{ "/present": "loaded" }] },
  );

  await app.start();

  assert.equal(app.target.PRESENT, "loaded");
  assert.equal(app.target.MISSING, undefined);
  assert.deepEqual(app.warnings, ["SSM parameters not found: /missing"]);
});

test("session_start keeps running when SSM loading fails", async () => {
  const app = setup(
    { ssmEnv: { parameters: { SECRET: "/secret" } } },
    { error: new Error("SSO session expired") },
  );

  await app.start();

  assert.equal(app.target.SECRET, undefined);
  assert.deepEqual(app.warnings, [
    "Failed to load SSM environment: SSO session expired",
  ]);
  assert.equal(app.destroyed, 1);
});

test("a later session replaces values previously managed by the extension", async () => {
  const app = setup(
    { ssmEnv: { parameters: { TOKEN: "/token" } } },
    {
      responses: [
        { "/token": "first" },
        { "/token": "second" },
      ],
    },
  );

  await app.start();
  assert.equal(app.target.TOKEN, "first");

  await app.start();
  assert.equal(app.target.TOKEN, "second");
});
