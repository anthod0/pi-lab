import assert from "node:assert/strict";
import test from "node:test";

import type { GetParametersCommandOutput } from "@aws-sdk/client-ssm";

import { fetchSsmEnv, type GetParametersSender } from "./ssm";

class FakeSsmClient implements GetParametersSender {
  readonly inputs: Array<{ Names?: string[]; WithDecryption?: boolean }> = [];

  constructor(
    private readonly respond: (
      names: string[],
    ) => GetParametersCommandOutput | Promise<GetParametersCommandOutput>,
  ) {}

  async send(command: { input: { Names?: string[]; WithDecryption?: boolean } }) {
    this.inputs.push(command.input);
    return this.respond(command.input.Names ?? []);
  }
}

test("fetchSsmEnv explicitly maps parameters and always requests decryption", async () => {
  const client = new FakeSsmClient((names) => ({
    $metadata: {},
    Parameters: names.map((Name) => ({ Name, Value: `value:${Name}` })),
  }));

  const result = await fetchSsmEnv(client, {
    DATABASE_URL: "/service/dev/database-url",
    REDIS_URL: "/service/dev/redis-url",
  });

  assert.deepEqual(client.inputs, [
    {
      Names: ["/service/dev/database-url", "/service/dev/redis-url"],
      WithDecryption: true,
    },
  ]);
  assert.deepEqual(result, {
    values: {
      DATABASE_URL: "value:/service/dev/database-url",
      REDIS_URL: "value:/service/dev/redis-url",
    },
    missingParameters: [],
  });
});

test("fetchSsmEnv batches requests at the SSM limit of ten names", async () => {
  const client = new FakeSsmClient((names) => ({
    $metadata: {},
    Parameters: names.map((Name) => ({ Name, Value: Name })),
  }));
  const parameters = Object.fromEntries(
    Array.from({ length: 11 }, (_, index) => [`ENV_${index}`, `/parameter/${index}`]),
  );

  const result = await fetchSsmEnv(client, parameters);

  assert.equal(client.inputs.length, 2);
  assert.equal(client.inputs[0]?.Names?.length, 10);
  assert.equal(client.inputs[1]?.Names?.length, 1);
  assert.equal(Object.keys(result.values).length, 11);
});

test("fetchSsmEnv reports missing parameters and keeps valid values", async () => {
  const client = new FakeSsmClient(() => ({
    $metadata: {},
    Parameters: [{ Name: "/present", Value: "loaded" }],
    InvalidParameters: ["/missing"],
  }));

  const result = await fetchSsmEnv(client, {
    PRESENT: "/present",
    MISSING: "/missing",
  });

  assert.deepEqual(result, {
    values: { PRESENT: "loaded" },
    missingParameters: ["/missing"],
  });
});

test("fetchSsmEnv fetches a duplicated remote parameter only once", async () => {
  const client = new FakeSsmClient((names) => ({
    $metadata: {},
    Parameters: [{ Name: names[0], Value: "shared" }],
  }));

  const result = await fetchSsmEnv(client, {
    FIRST: "/shared",
    SECOND: "/shared",
  });

  assert.deepEqual(client.inputs[0]?.Names, ["/shared"]);
  assert.deepEqual(result.values, { FIRST: "shared", SECOND: "shared" });
});
