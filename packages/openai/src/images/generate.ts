import { withFileMutationQueue, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getImageDimensions } from "@earendil-works/pi-tui";
import { getPiLabLocalDir } from "@pi-lab/utils";
import { lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";

import { imageCapabilities, validateImageInput, type ImageConfig, type ImageInput } from "./capabilities";
import { codexImageHeaders } from "./codex";
import { openaiImageHeaders } from "./openai";

function localPath(cwd: string, path: string): string {
	const clean = path.replace(/^@/, "");
	return resolve(cwd, clean.startsWith("~/") ? join(homedir(), clean.slice(2)) : clean);
}

function rasterFormat(bytes: Buffer): string | undefined {
	if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
	if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpeg";
	if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
	if (["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) return "gif";
	return undefined;
}

async function inputImage(cwd: string, path: string, signal: AbortSignal) {
	const bytes = await readFile(localPath(cwd, path), { signal });
	const format = rasterFormat(bytes);
	if (!format || !["png", "jpeg", "webp"].includes(format)) throw new Error(`Input must be PNG, JPEG or WebP: ${path}`);
	const encoded = bytes.toString("base64");
	const dimensions = getImageDimensions(encoded, `image/${format}`);
	if (!dimensions || !dimensions.widthPx || !dimensions.heightPx) throw new Error(`Cannot read image dimensions: ${path}`);
	const image_url = `data:image/${format};base64,${encoded}`;
	if (image_url.length > 20971520) throw new Error(`Input exceeds the 20 MiB Data URL limit: ${path}`);
	return { image_url, format, dimensions };
}

async function checkOutput(path: string): Promise<void> {
	try {
		await lstat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	throw new Error(`Output already exists: ${path}`);
}

export async function generateImages(config: ImageConfig, input: ImageInput, ctx: Pick<ExtensionContext, "cwd" | "modelRegistry">, callerSignal?: AbortSignal) {
	validateImageInput(config, input);
	const timeout = AbortSignal.timeout(300_000);
	const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
	signal.throwIfAborted();
	const headers = config.backend === "codex" ? await codexImageHeaders(ctx.modelRegistry) : await openaiImageHeaders(ctx.modelRegistry);
	signal.throwIfAborted();
	const images = await Promise.all((input.images ?? []).map((path) => inputImage(ctx.cwd, path, signal)));
	const { prompt, output, images: _paths, mask, markup, ...options } = input;
	const body: Record<string, unknown> = config.backend === "codex"
		? { model: "gpt-image-2", prompt, n: 1, size: "auto", quality: "auto" }
		: { model: config.model, prompt, n: 1, output_format: "png", ...options };
	if (images.length) body.images = images.map(({ image_url }) => ({ image_url }));
	for (const [field, path] of [["mask", mask], ["markup", markup]] as const) {
		if (!path) continue;
		const overlay = await inputImage(ctx.cwd, path, signal);
		if (overlay.format !== "png" ||
			overlay.dimensions.widthPx !== images[0].dimensions.widthPx || overlay.dimensions.heightPx !== images[0].dimensions.heightPx) {
			throw new Error(`${field} must be a PNG with alpha matching the first image's dimensions.`);
		}
		body[field] = { image_url: overlay.image_url };
	}
	const format = input.output_format ?? "png";
	const count = input.n ?? 1;
	let destination: string;
	if (output) {
		destination = localPath(ctx.cwd, output);
		const extension = extname(destination).slice(1).toLowerCase();
		if (extension !== format && !(format === "jpeg" && extension === "jpg")) throw new Error(`Output extension must match ${format}.`);
	} else {
		const base = join(getPiLabLocalDir(ctx.cwd), "openai", "images");
		await mkdir(base, { recursive: true });
		destination = join(await mkdtemp(join(base, "run-")), `image.${format}`);
	}
	const extension = extname(destination);
	const paths = Array.from({ length: count }, (_, index) => count === 1 ? destination : `${destination.slice(0, -extension.length)}-${index + 1}${extension}`);
	await mkdir(dirname(destination), { recursive: true });
	await Promise.all(paths.map(checkOutput));
	signal.throwIfAborted();
	const baseUrl = config.backend === "codex" ? "https://chatgpt.com/backend-api/codex" : "https://api.openai.com/v1";
	let response: Response;
	try {
		response = await fetch(`${baseUrl}/images/${images.length ? "edits" : "generations"}`, {
			method: "POST", headers, body: JSON.stringify(body), signal, redirect: "error",
		});
	} catch (error) {
		throw new Error("Image request was interrupted or could not connect. It may have consumed quota; no automatic retry was made.", { cause: error });
	}
	const contentType = response.headers.get("content-type") ?? "unknown";
	if (!response.ok) throw new Error(`Image request failed: HTTP ${response.status} (${contentType}). Check credentials, model access and quota. No automatic retry was made.`);
	if (!contentType.includes("application/json")) throw new Error(`Expected image JSON, received ${contentType}.`);
	const result = await response.json() as { data?: { b64_json?: string }[] };
	if (!Array.isArray(result.data) || result.data.length !== count) throw new Error(`Image API did not return the requested ${count} image(s).`);
	const decoded = result.data.map((item) => {
		if (typeof item.b64_json !== "string" || !item.b64_json.length || item.b64_json.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.b64_json)) {
			throw new Error("Image API returned invalid Base64 image data.");
		}
		const bytes = Buffer.from(item.b64_json, "base64");
		if (format === "svg") {
			if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/.test(bytes.toString("utf8"))) throw new Error("Image API did not return SVG.");
			return { bytes, dimensions: undefined };
		}
		if (rasterFormat(bytes) !== format) throw new Error(`Image API did not return ${format}.`);
		const dimensions = getImageDimensions(item.b64_json, `image/${format}`);
		if (!dimensions || !dimensions.widthPx || !dimensions.heightPx) throw new Error("Image API returned an invalid image.");
		return { bytes, dimensions };
	});
	const saved: { path: string; format: string; width?: number; height?: number }[] = [];
	try {
		for (const [index, image] of decoded.entries()) {
			await withFileMutationQueue(paths[index], async () => {
				signal.throwIfAborted();
				await writeFile(paths[index], image.bytes, { flag: "wx" });
			});
			saved.push({ path: paths[index], format, ...(image.dimensions ? { width: image.dimensions.widthPx, height: image.dimensions.heightPx } : {}) });
		}
	} catch (error) {
		throw new Error(`Could not save all images. Saved files: ${saved.map((image) => image.path).join(", ") || "none"}`, { cause: error });
	}
	return { backend: config.backend, requestedModel: imageCapabilities(config).model, images: saved };
}
