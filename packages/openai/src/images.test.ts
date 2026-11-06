import assert from "node:assert/strict";
import { mkdtempDisposableSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";

import { imageCapabilities, validateImageInput, type ImageConfig, type ImageInput } from "./images/capabilities";
import { generateImages } from "./images/generate";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const openai: ImageConfig = { backend: "openai", model: "gpt-image-2" };
const codex: ImageConfig = { backend: "codex" };

function setup(t: TestContext) {
	const root = mkdtempDisposableSync(join(tmpdir(), "pi-openai-images-"));
	t.after(() => root.remove());
	const originalKey = process.env.OPENAI_API_KEY;
	delete process.env.OPENAI_API_KEY;
	t.after(() => { if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey; });
	const token = `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-account" } })).toString("base64url")}.signature`;
	let oauth = false;
	const authProviders: string[] = [];
	const registry = {
		async getProviderAuth(provider: string) {
			authProviders.push(provider);
			return provider === "openai-codex"
				? { source: "OAuth", auth: { apiKey: token } }
				: { source: oauth ? "OAuth" : "OPENAI_API_KEY", auth: { apiKey: "test-key" } };
		},
	} as ExtensionContext["modelRegistry"];
	const requests: { url: string; headers: Headers; body: Record<string, any>; signal: AbortSignal }[] = [];
	let respond = async (_request: typeof requests[number]): Promise<Response> => Response.json({ data: [{ b64_json: png }] });
	t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
		const request = { url, headers: new Headers(init.headers), body: JSON.parse(init.body as string), signal: init.signal as AbortSignal };
		requests.push(request);
		return respond(request);
	});
	return {
		cwd: root.path, requests, authProviders,
		setOAuth() { oauth = true; },
		respond(fn: typeof respond) { respond = fn; },
		write(name: string, base64 = png) { const path = join(root.path, name); writeFileSync(path, Buffer.from(base64, "base64")); return path; },
		generate(config: ImageConfig, input: ImageInput = { prompt: "Draw a circle" }, signal?: AbortSignal) {
			return generateImages(config, input, { cwd: root.path, modelRegistry: registry }, signal);
		},
	};
}

test("Codex uses its refreshed OAuth token, account header and fixed model, returning actual image dimensions", async (t) => {
	const app = setup(t);
	const result = await app.generate(codex);
	assert.deepEqual(app.authProviders, ["openai-codex"]);
	assert.equal(app.requests[0].url, "https://chatgpt.com/backend-api/codex/images/generations");
	assert.deepEqual(app.requests[0].body, { model: "gpt-image-2", prompt: "Draw a circle", n: 1, size: "auto", quality: "auto" });
	assert.equal(app.requests[0].headers.get("chatgpt-account-id"), "test-account");
	assert.equal(app.requests[0].headers.get("user-agent"), "pi");
	assert.match(app.requests[0].headers.get("x-codex-image-turn-id")!, /^[0-9a-f-]{36}$/);
	assert.equal(readFileSync(result.images[0].path).toString("base64"), png);
	assert.deepEqual({ width: result.images[0].width, height: result.images[0].height }, { width: 1, height: 1 });
	assert.equal(result.requestedModel, "gpt-image-2");
});

for (const config of [codex, openai]) {
	test(`${config.backend} selects edits and sends local reference images as Data URLs`, async (t) => {
		const app = setup(t);
		const reference = app.write("reference.png");
		const result = await app.generate(config, { prompt: "Make it green", images: [reference], output: "edited.png" });
		assert.ok(app.requests[0].url.endsWith("/images/edits"));
		assert.deepEqual(app.requests[0].body.images, [{ image_url: `data:image/png;base64,${png}` }]);
		assert.equal(readFileSync(reference).toString("base64"), png);
		assert.equal(result.images[0].path, join(app.cwd, "edited.png"));
	});
}

test("OpenAI uses the configured image model and saves every batch result without returning Base64", async (t) => {
	const app = setup(t);
	app.respond(async () => Response.json({ data: [{ b64_json: png }, { b64_json: png }] }));
	const result = await app.generate({ backend: "openai", model: "gpt-image-2.5-flare" }, {
		prompt: "Two icons", n: 2, output: "icon.png", size: "1536x864", quality: "xhigh", background: "transparent",
	});
	assert.equal(app.requests[0].url, "https://api.openai.com/v1/images/generations");
	assert.equal(app.requests[0].headers.get("authorization"), "Bearer test-key");
	assert.equal(app.requests[0].headers.has("chatgpt-account-id"), false);
	assert.deepEqual(app.requests[0].body, {
		model: "gpt-image-2.5-flare", prompt: "Two icons", n: 2, output_format: "png", size: "1536x864", quality: "xhigh", background: "transparent",
	});
	assert.deepEqual(result.images.map((image) => image.path), [join(app.cwd, "icon-1.png"), join(app.cwd, "icon-2.png")]);
	for (const image of result.images) assert.equal(readFileSync(image.path).toString("base64"), png);
	assert.equal(JSON.stringify(result).includes(png), false);
});

test("ChatGPT OAuth cannot be sent to Images API, but an explicit environment key works alongside it", async (t) => {
	const app = setup(t);
	app.setOAuth();
	await assert.rejects(app.generate(openai));
	assert.equal(app.requests.length, 0);
	process.env.OPENAI_API_KEY = "test-image-only-key";
	await app.generate(openai);
	assert.equal(app.requests[0].headers.get("authorization"), "Bearer test-image-only-key");
	assert.deepEqual(app.authProviders, ["openai"]);
});

test("existing batch outputs prevent any paid request or overwritten data", async (t) => {
	const app = setup(t);
	const existing = app.write("icon-2.png");
	await assert.rejects(app.generate(openai, { prompt: "Icons", output: "icon.png", n: 2 }));
	assert.equal(app.requests.length, 0);
	assert.equal(readFileSync(existing).toString("base64"), png);
	assert.deepEqual(readdirSync(app.cwd), ["icon-2.png"]);
});

test("a file created while generation is in flight is not overwritten", async (t) => {
	const app = setup(t);
	app.respond(async () => { writeFileSync(join(app.cwd, "image.png"), "concurrent content"); return Response.json({ data: [{ b64_json: png }] }); });
	await assert.rejects(app.generate(openai, { prompt: "Circle", output: "image.png" }));
	assert.equal(readFileSync(join(app.cwd, "image.png"), "utf8"), "concurrent content");
});

test("OpenAI sends masks and rejects dimension mismatches before requesting", async (t) => {
	const app = setup(t);
	const reference = app.write("reference.png");
	const mask = app.write("mask.png");
	await app.generate(openai, { prompt: "Edit", images: [reference], mask, output: "result.png" });
	assert.deepEqual(app.requests[0].body.mask, { image_url: `data:image/png;base64,${png}` });
	const wrongSize = Buffer.from(png, "base64");
	wrongSize.writeUInt32BE(2, 16);
	writeFileSync(mask, wrongSize);
	await assert.rejects(app.generate(openai, { prompt: "Edit", images: [reference], mask }));
	assert.equal(app.requests.length, 1);
});

for (const [name, config, input] of [
	["Codex quality", codex, { quality: "low" }],
	["unknown backend override", openai, { backend: "codex" }],
	["model override", openai, { model: "another-model" }],
	["unsupported quality", openai, { quality: "max" }],
	["unsupported SVG", openai, { output_format: "svg" }],
	["invalid custom size", openai, { size: "1025x1024" }],
	["too many pixels", openai, { size: "3840x3840" }],
	["transparent JPEG", openai, { output_format: "jpeg", background: "transparent" }],
	["PNG compression", openai, { output_compression: 50 }],
	["mask without input", openai, { mask: "mask.png" }],
	["unknown input", openai, { unexpected: true }],
] as const) {
	test(`rejects ${name} before reading credentials or calling an API`, async (t) => {
		const app = setup(t);
		await assert.rejects(app.generate(config, { prompt: "Circle", ...input }));
		assert.deepEqual(app.authProviders, []);
		assert.equal(app.requests.length, 0);
	});
}

test("tool schemas expose only parameters and values supported by the backend and model", () => {
	const codexSchema = imageCapabilities(codex).parameters;
	assert.deepEqual(Object.keys(codexSchema.properties).sort(), ["images", "output", "prompt"]);
	const mini = imageCapabilities({ backend: "openai", model: "gpt-image-1-mini" }).parameters;
	assert.equal(Value.Check(mini, { prompt: "Circle", size: "1536x864" }), false);
	assert.equal(Value.Check(mini, { prompt: "Circle", input_fidelity: "high" }), false);
	const second = imageCapabilities(openai).parameters;
	assert.equal(Value.Check(second, { prompt: "Circle", input_fidelity: "low" }), false);
	const newer = imageCapabilities({ backend: "openai", model: "gpt-image-2.6-flare" }).parameters;
	assert.equal(Value.Check(newer, { prompt: "Circle", quality: "max", output_format: "gif", frame_count: 4, complexity: "low" }), true);
	assert.equal(Value.Check(second, { prompt: "Circle", frame_count: 4 }), false);
});

test("GIF and SVG restrictions are enforced for models that support those formats", () => {
	const config: ImageConfig = { backend: "openai", model: "gpt-image-2.6-sunburst" };
	for (const input of [
		{ output_format: "svg", n: 2 }, { output_format: "svg", images: ["reference.png"] },
		{ output_format: "gif", mask: "mask.png", images: ["reference.png"] },
		{ output_format: "png", frame_count: 4 }, { output_format: "gif", output_compression: 50 },
		{ images: ["reference.png"], mask: "mask.png", markup: "markup.png" },
	]) assert.throws(() => validateImageInput(config, { prompt: "Circle", ...input }));
});

test("SVG bytes are saved as SVG without inventing raster dimensions", async (t) => {
	const app = setup(t);
	const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="3"/></svg>';
	app.respond(async () => Response.json({ data: [{ b64_json: Buffer.from(svg).toString("base64") }] }));
	const result = await app.generate({ backend: "openai", model: "gpt-image-2.6-flare" }, { prompt: "Circle", output_format: "svg" });
	assert.equal(readFileSync(result.images[0].path, "utf8"), svg);
	assert.equal(result.images[0].width, undefined);
});

for (const response of [
	() => new Response("<html>Forbidden</html>", { status: 403, headers: { "content-type": "text/html" } }),
	() => new Response("Unavailable", { status: 503 }),
	() => Response.json({ data: [] }),
	() => Response.json({ data: [{ b64_json: "invalid!" }] }),
	() => Response.json({ data: [{ b64_json: Buffer.from("not an image").toString("base64") }] }),
]) {
	test("failed or malformed responses do not retry, switch backends or save an image", async (t) => {
		const app = setup(t);
		app.respond(async () => response());
		await assert.rejects(app.generate(codex, { prompt: "Circle", output: "result.png" }));
		assert.equal(app.requests.length, 1);
		assert.deepEqual(app.authProviders, ["openai-codex"]);
		assert.deepEqual(readdirSync(app.cwd), []);
	});
}

test("cancellation stops an in-flight request without retry or output", async (t) => {
	const app = setup(t);
	const controller = new AbortController();
	app.respond(async (request) => {
		controller.abort();
		request.signal.throwIfAborted();
		return Response.json({});
	});
	await assert.rejects(app.generate(openai, { prompt: "Circle", output: "result.png" }, controller.signal));
	assert.equal(app.requests.length, 1);
	assert.deepEqual(readdirSync(app.cwd), []);
});
