import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

export type ImageConfig = { backend: "codex" } | { backend: "openai"; model: string };

const raster = ["png", "jpeg", "webp"];
const standardQuality = ["auto", "low", "medium", "high"];
const standardSizes = ["auto", "1024x1024", "1536x1024", "1024x1536"];
const image1Capabilities = { formats: raster, quality: standardQuality, flexibleSize: false, markup: false, complexity: false, fidelity: ["low", "high"] };
const image2Capabilities = { ...image1Capabilities, flexibleSize: true, fidelity: [] };
const image25Capabilities = { ...image2Capabilities, quality: [...standardQuality, "xhigh", "max"], markup: true };
const image26Capabilities = { ...image25Capabilities, formats: [...raster, "svg", "gif"], complexity: true };

// Explicit IDs keep tool declarations stable; moving aliases cannot promise a capability set.
export const IMAGE_MODELS: Record<string, typeof image1Capabilities> = {
	"gpt-image-1-mini": { ...image1Capabilities, fidelity: ["low"] },
	"gpt-image-1.5": image1Capabilities,
	"gpt-image-2": image2Capabilities,
	"gpt-image-2-2026-04-21": image2Capabilities,
	"gpt-image-2.5-sunburst": image25Capabilities,
	"gpt-image-2.5-sunburst-2026-09-08": image25Capabilities,
	"gpt-image-2.5-flare": image25Capabilities,
	"gpt-image-2.5-flare-2026-09-08": image25Capabilities,
	"gpt-image-2.6-sunburst": image26Capabilities,
	"gpt-image-2.6-flare": image26Capabilities,
};

export function parseImageConfig(value: unknown): ImageConfig | false {
	if (value === false) return false;
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("openai.imageGeneration must be false or an object");
	const config = value as Record<string, unknown>;
	if (config.backend !== "codex" && config.backend !== "openai") throw new Error("imageGeneration.backend must be codex or openai");
	const allowed = config.backend === "codex" ? ["backend"] : ["backend", "model"];
	for (const key of Object.keys(config)) {
		if (!allowed.includes(key)) throw new Error(`Unsupported ${config.backend} image setting: ${key}`);
	}
	if (config.backend === "codex") return { backend: "codex" };
	if (typeof config.model !== "string" || !Object.hasOwn(IMAGE_MODELS, config.model)) {
		throw new Error(`imageGeneration.model must be one of: ${Object.keys(IMAGE_MODELS).join(", ")}`);
	}
	return { backend: "openai", model: config.model };
}

function choice(values: string[], description: string) {
	return Type.String({ enum: values, description });
}

const properties = {
	prompt: Type.String({ minLength: 1, maxLength: 32000, pattern: "\\S", description: "Describe the image, or what to change and preserve when editing." }),
	images: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 16, description: "Local reference/edit-target image paths, in order. PNG, JPEG or WebP. Supplying images selects editing." })),
	output: Type.Optional(Type.String({ minLength: 1, description: "New output file path. For n > 1, uses name-1.ext, name-2.ext, etc. Never overwrites. Default: .pi/pi-lab/openai/images/run-*/image.ext" })),
	size: Type.Optional(Type.String()),
	quality: Type.Optional(Type.String()),
	background: Type.Optional(choice(["auto", "opaque", "transparent"], "Background; transparent requires PNG or WebP.")),
	output_format: Type.Optional(Type.String()),
	n: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, description: "Number of images; default 1. SVG requires 1." })),
	output_compression: Type.Optional(Type.Integer({ minimum: 0, maximum: 100, description: "JPEG/WebP compression quality; only valid for these formats." })),
	mask: Type.Optional(Type.String({ minLength: 1, description: "Local PNG mask with alpha; transparent areas of the first input image are edited. Must match its dimensions." })),
	markup: Type.Optional(Type.String({ minLength: 1, description: "Local transparent PNG markup overlay matching the first input's dimensions. Cannot combine with mask." })),
	input_fidelity: Type.Optional(Type.String()),
	complexity: Type.Optional(choice(["low", "medium", "high"], "Image planning effort, separate from rendering quality.")),
	frame_count: Type.Optional(Type.Integer({ minimum: 2, maximum: 16, description: "GIF only: number of frames; default 9." })),
	frame_duration_ms: Type.Optional(Type.Integer({ minimum: 20, maximum: 2000, description: "GIF only: frame duration in milliseconds; rounded by the API to 10 ms." })),
};

const allParameters = Type.Object(properties, { additionalProperties: false });
export type ImageInput = Static<typeof allParameters>;

export function imageCapabilities(config: ImageConfig) {
	if (config.backend === "codex") {
		const parameters = Type.Object({ prompt: properties.prompt, images: properties.images, output: properties.output }, { additionalProperties: false });
		return {
			model: "gpt-image-2",
			parameters: parameters as typeof allParameters,
			description: "Generate or edit one PNG through Codex using the openai-codex login and account quota. Requests gpt-image-2; the backend does not reliably report the actual model or honor exact dimensions. No model, size, quality, format, mask or batch selection. Returns saved paths and actual dimensions. Five-minute timeout; no automatic retry or backend fallback.",
		};
	}
	const capability = IMAGE_MODELS[config.model];
	const { markup, input_fidelity, complexity, frame_count, frame_duration_ms, ...common } = properties;
	const parameters = Type.Object({
		...common,
		size: Type.Optional(capability.flexibleSize
			? Type.String({ pattern: "^(auto|[1-9][0-9]*x[1-9][0-9]*)$", description: "auto or WIDTHxHEIGHT. Raster: multiples of 16, aspect ratio 1:3–3:1, edges ≤3840, 655360–8294400 pixels. GIF has model-specific frame/total-pixel limits; prefer auto." })
			: choice(standardSizes, "Output dimensions; default auto.")),
		quality: Type.Optional(choice(capability.quality, "Rendering quality; default auto.")),
		output_format: Type.Optional(choice(capability.formats, `Output format; default png.${capability.formats.includes("svg") ? " SVG: generation only, n=1. GIF requires account access." : ""}`)),
		n: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, description: `Number of images; default 1.${capability.formats.includes("svg") ? " SVG requires 1." : ""}` })),
		...(capability.markup ? { markup } : {}),
		...(capability.fidelity.length ? { input_fidelity: Type.Optional(choice(capability.fidelity, "Editing only: how closely to preserve input details.")) } : {}),
		...(capability.complexity ? { complexity } : {}),
		...(capability.formats.includes("gif") ? { frame_count, frame_duration_ms } : {}),
	}, { additionalProperties: false });
	return {
		model: config.model,
		parameters: parameters as typeof allParameters,
		description: `Generate or edit images with OpenAI Images API model ${config.model}. Formats: ${capability.formats.join(", ")}. Quality: ${capability.quality.join(", ")}. ${capability.flexibleSize ? "Supports custom raster dimensions." : "Supports standard raster dimensions."} Supports 1–10 outputs and masked editing.${capability.markup ? " Supports markup-guided editing." : ""}${capability.complexity ? " Supports image planning effort and animated GIF; SVG generation requires one output and no input images." : ""}`,
	};
}

export function validateImageInput(config: ImageConfig, input: ImageInput): void {
	const { parameters } = imageCapabilities(config);
	if (!Value.Check(parameters, input)) {
		const error = [...Value.Errors(parameters, input)][0];
		throw new Error(`Invalid image input at ${error.instancePath}: ${error.message}`);
	}
	if (config.backend === "codex") return;
	const format = input.output_format ?? "png";
	if (input.background === "transparent" && !["png", "webp"].includes(format)) throw new Error("Transparent backgrounds require PNG or WebP.");
	if (input.output_compression !== undefined && !["jpeg", "webp"].includes(format)) throw new Error("output_compression requires JPEG or WebP.");
	if ((input.mask || input.markup || input.input_fidelity) && !input.images?.length) throw new Error("mask, markup and input_fidelity require input images.");
	if (input.mask && input.markup) throw new Error("Use either mask or markup, not both.");
	if (format === "svg" && (input.images?.length || (input.n ?? 1) !== 1)) throw new Error("SVG requires generation without input images and n=1.");
	if (format === "gif" && (input.mask || input.markup)) throw new Error("GIF does not support masks or markup overlays.");
	if (format !== "gif" && (input.frame_count !== undefined || input.frame_duration_ms !== undefined)) throw new Error("Frame parameters require GIF output.");
	if (input.size && input.size !== "auto" && IMAGE_MODELS[config.model].flexibleSize) {
		const [width, height] = input.size.split("x").map(Number);
		if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width % 16 || height % 16) throw new Error("Image dimensions must be positive integer multiples of 16.");
		if (format !== "gif" && (Math.max(width, height) > 3840 || width / height > 3 || height / width > 3 || width * height < 655360 || width * height > 8294400)) {
			throw new Error("Image dimensions exceed the model's raster size limits.");
		}
	}
}
