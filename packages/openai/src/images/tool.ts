import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import { imageCapabilities, type ImageConfig } from "./capabilities";
import { generateImages } from "./generate";

export function imageToolRegistration(pi: ExtensionAPI) {
	let registered = false;
	return (config: ImageConfig | false | undefined) => {
		if (!config) {
			if (registered) pi.registerTool({
				name: "generate_image", label: "Generate image", description: "Image generation is disabled.",
				parameters: Type.Object({}), exposure: "hidden",
				async execute() { throw new Error("Image generation is disabled. Configure openai.imageGeneration and /reload."); },
			});
			return;
		}
		const capability = imageCapabilities(config);
		pi.registerTool({
			name: "generate_image",
			label: `Generate image (${config.backend}: ${capability.model})`,
			description: capability.description,
			promptSnippet: `Generate or edit images with ${config.backend} (${capability.model})`,
			promptGuidelines: ["Use generate_image for AI-generated images. For edits, supply local images and specify what to change and preserve. Inspect the saved image before further editing."],
			parameters: capability.parameters,
			renderCall(args, theme, context) {
				const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
				let content = theme.fg("toolTitle", theme.bold("generate_image"));
				if (context.isPartial && typeof args.prompt === "string") content += `\n${theme.fg("toolOutput", args.prompt)}`;
				text.setText(content);
				return text;
			},
			async execute(_id, input, signal, onUpdate, ctx) {
				onUpdate?.({ content: [{ type: "text", text: `Generating with ${config.backend} (${capability.model})…` }], details: undefined });
				const result = await generateImages(config, input, ctx, signal);
				return {
					content: [{ type: "text", text: result.images.map((image) => `Saved image: ${image.path}${image.width ? ` (${image.width}×${image.height})` : ""}`).join("\n") }],
					details: result,
				};
			},
		});
		registered = true;
	};
}
