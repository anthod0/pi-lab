import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { generateImage } from "./generate.js";

// Tests retain their unique temp roots for inspection; never touch HOME or user Codex data.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-image-test-"));
  const generated = join(root, "generated_images");
  await mkdir(generated);
  const source = join(generated, "new.png");
  const exec: ExtensionAPI["exec"] = async (command, args, options) => {
    assert.equal(command, "codex");
    assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
    assert.equal(options?.timeout, 300_000);
    await writeFile(source, png);
    await writeFile(args[args.indexOf("--output-last-message") + 1], JSON.stringify({ path: source, error: "" }));
    return { stdout: "done", stderr: "", code: 0, killed: false };
  };
  return { root, generated, source, exec };
}

test("passes the default or configured model through -m", async () => {
  const f = await fixture();
  for (const model of [undefined, "gpt-5.5", "gpt-5.6-luna"]) {
    const exec: ExtensionAPI["exec"] = (command, args, options) => {
      assert.equal(args[args.indexOf("-m") + 1], model ?? "gpt-5.6-sol");
      return f.exec(command, args, options);
    };
    await generateImage({ prompt: "robot" }, f.root, exec, undefined, f.generated, model);
  }
});

test("generates a PNG and persists diagnostics under the project plugin directory", async () => {
  const f = await fixture();
  const result = await generateImage({ prompt: "robot" }, f.root, f.exec, undefined, f.generated);
  assert.deepEqual(await readFile(result.path), png);
  assert.ok(result.path.startsWith(join(f.root, ".pi", "pi-lab", "codex-image")));
  assert.match(await readFile(join(result.runDir, "codex.log"), "utf8"), /done/);
});

test("passes reference paths as arguments and saves to a requested path", async () => {
  const f = await fixture();
  const input = join(f.root, "reference with spaces.png");
  await writeFile(input, png);
  const exec: ExtensionAPI["exec"] = (command, args, options) => {
    assert.equal(args[args.indexOf("--image") + 1], input);
    assert.equal(args.at(-2), "--");
    return f.exec(command, args, options);
  };
  const result = await generateImage({ prompt: "make blue", images: [input], output: "art/edit.png" }, f.root, exec, undefined, f.generated);
  assert.equal(result.path, join(f.root, "art/edit.png"));
});

test("rejects existing output before running Codex", async () => {
  const f = await fixture();
  const path = join(f.root, "existing.png");
  await writeFile(path, "keep");
  await assert.rejects(generateImage({ prompt: "robot", output: path }, f.root, async () => { throw new Error("should not execute"); }), /already exists/);
  assert.equal(await readFile(path, "utf8"), "keep");
});

test("exclusive copy protects a destination created during generation", async () => {
  const f = await fixture();
  const output = join(f.root, "raced.png");
  const exec: ExtensionAPI["exec"] = async (...args) => {
    await writeFile(output, "keep");
    return f.exec(...args);
  };
  await assert.rejects(generateImage({ prompt: "robot", output }, f.root, exec, undefined, f.generated), /EEXIST/);
  assert.equal(await readFile(output, "utf8"), "keep");
});

for (const scenario of ["timeout", "exit", "error", "invalid", "outside", "not-png"] as const) {
  test(`rejects ${scenario} rather than reporting success`, async () => {
    const f = await fixture();
    const exec: ExtensionAPI["exec"] = async (command, args, options) => {
      const result = await f.exec(command, args, options);
      const response = args[args.indexOf("--output-last-message") + 1];
      if (scenario === "timeout") result.killed = true;
      if (scenario === "exit") result.code = 1;
      if (scenario === "error") await writeFile(response, JSON.stringify({ path: "", error: "image tool unavailable" }));
      if (scenario === "invalid") await writeFile(response, "not JSON");
      if (scenario === "outside") await writeFile(response, JSON.stringify({ path: response, error: "" }));
      if (scenario === "not-png") await writeFile(f.source, "not an image");
      return result;
    };
    await assert.rejects(generateImage({ prompt: "robot" }, f.root, exec, undefined, f.generated), /Diagnostics:/);
  });
}

test("cancels an active executor without publishing an output", async () => {
  const f = await fixture();
  const controller = new AbortController();
  const output = join(f.root, "cancelled.png");
  let started!: () => void;
  const running = new Promise<void>((resolve) => { started = resolve; });
  const exec: ExtensionAPI["exec"] = async (_command, _args, options) => {
    assert.equal(options?.signal, controller.signal);
    started();
    await new Promise<void>((resolve) => options!.signal!.addEventListener("abort", () => resolve(), { once: true }));
    return { code: 0, killed: true, stdout: "", stderr: "" };
  };
  const result = generateImage({ prompt: "robot", output }, f.root, exec, controller.signal, f.generated);
  const rejected = assert.rejects(result, /abort/i);
  await running;
  controller.abort();
  await rejected;
  await assert.rejects(readFile(output), { code: "ENOENT" });
});

test("propagates cancellation and does not start when already aborted", async () => {
  const f = await fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(generateImage({ prompt: "robot" }, f.root, async () => { throw new Error("should not execute"); }, controller.signal), /abort/i);
});
