import { resizeImage, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "@sinclair/typebox";
import { generateImage } from "./generate.js";
import { readImageModel } from "./settings.js";

const parameters = Type.Object({
  prompt: Type.String({ minLength: 1, maxLength: 16000, description: "Image instructions: subject, style, composition, text, and what to preserve/change for edits." }),
  images: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 8, description: "Local reference/edit-target images, in order. Describe each image's role in the prompt." })),
  output: Type.Optional(Type.String({ minLength: 1, description: "New PNG output path, relative to cwd or absolute. Never overwrites. Default: .pi/pi-lab/codex-image/run-*/image.png" })),
});

export type GenerateImageInput = Static<typeof parameters>;

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "generate_image",
    label: "Generate image (Codex)",
    description: "Generate or edit one PNG using locally installed, logged-in Codex CLI. Returns image preview and saved path. Requires built-in image generation (tested with Codex 0.154.0). Five-minute timeout; errors are bounded and full CLI logs are saved locally. No external API fallback.",
    promptSnippet: "Generate or edit images using Codex CLI",
    promptGuidelines: ["Use generate_image for AI-generated raster images. For edits, supply local images and specify what to change and preserve."],
    parameters,
    async execute(_id, params, signal, onUpdate, ctx) {
      const model = readImageModel(ctx.cwd, ctx.isProjectTrusted());
      onUpdate?.({ content: [{ type: "text", text: `Generating image with Codex (${model})…` }], details: { model } });
      const result = await generateImage(params, ctx.cwd, pi.exec.bind(pi), signal, undefined, model);
      const preview = await resizeImage(result.bytes, "image/png", { maxWidth: 1536, maxHeight: 1536, maxBytes: 4 * 1024 * 1024 });
      return {
        content: [
          { type: "text" as const, text: `Saved image: ${result.path}${preview ? "" : "\nPreview unavailable; original PNG saved."}` },
          ...(preview ? [{ type: "image" as const, data: preview.data, mimeType: preview.mimeType }] : []),
        ],
        details: { path: result.path, runDir: result.runDir, model },
      };
    },
  });
}
