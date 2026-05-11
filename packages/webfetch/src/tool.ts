import { Type } from "@sinclair/typebox";
import { type ExtensionAPI, keyHint } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { WebFetchConfig } from "./config.js";
import { WebFetchCache } from "./cache.js";
import { normalizeUrl } from "./normalize.js";
import { fetchUrl } from "./fetch.js";
import { processHtml, processPlainText } from "./content.js";
import type { InlineScript } from "./content.js";
import { getBinaryTempDir } from "./paths.js";
import { applyFetchOptimizations, processHtmlWithOptimizations } from "./optimizers/index.js";

// ─── Output shapes ────────────────────────────────────────────────────────────

interface TextOutput {
	content: string;
	truncated: boolean;
	total_length: number;
	offset: number;
	returned_length: number;
	url: string;
}

interface BinaryOutput {
	file_path: string;
	content_type: string;
	url: string;
}

interface RedirectOutput {
	redirect: true;
	original_url: string;
	redirect_url: string;
	status_code: number;
	message: string;
}

// ─── Text formatters ──────────────────────────────────────────────────────────

function formatScriptIndex(scripts: InlineScript[]): string {
	if (scripts.length === 0) return "";
	const width = String(scripts.reduce((m, s) => Math.max(m, s.length), 0)).length;
	const lines = scripts.map(
		(s) => `  [${s.index}] ${String(s.length).padStart(width)} chars  ${s.preview}`,
	);
	return [
		"",
		`Inline scripts (${scripts.length}, call webfetch with script=N to read full content):`,
		...lines,
	].join("\n");
}

function formatTextResult(output: TextOutput, scripts: InlineScript[]): string {
	const lines: string[] = [];
	lines.push(`URL: ${output.url}`);
	if (output.truncated) {
		const next = output.offset + output.returned_length;
		lines.push(
			`Offset: ${output.offset} / ${output.total_length} chars — truncated, call again with offset=${next}`,
		);
	} else {
		lines.push(`Length: ${output.total_length} chars`);
	}
	lines.push("", "---", "", output.content);
	const scriptIndex = formatScriptIndex(scripts);
	if (scriptIndex) lines.push(scriptIndex);
	return lines.join("\n");
}

function formatScriptResult(url: string, scriptIndex: number, output: TextOutput): string {
	const lines: string[] = [];
	lines.push(`URL: ${url} — script ${scriptIndex}`);
	if (output.truncated) {
		const next = output.offset + output.returned_length;
		lines.push(
			`Offset: ${output.offset} / ${output.total_length} chars — truncated, call again with offset=${next}`,
		);
	} else {
		lines.push(`Length: ${output.total_length} chars`);
	}
	lines.push("", "---", "", output.content);
	return lines.join("\n");
}

function formatBinaryResult(output: BinaryOutput): string {
	return [
		`BINARY FILE: ${output.file_path}`,
		`Content-Type: ${output.content_type}`,
		`URL: ${output.url}`,
	].join("\n");
}

function formatRedirectResult(output: RedirectOutput): string {
	return [
		`REDIRECT ${output.status_code}: ${output.original_url} → ${output.redirect_url}`,
		output.message,
	].join("\n");
}

// ─── Tool registration ────────────────────────────────────────────────────────

export function registerWebFetchTool(pi: ExtensionAPI, config: WebFetchConfig): void {
	const cache = new WebFetchCache(config.cache);

	pi.on("session_shutdown", async () => {
		cache.clear();
	});

	pi.registerTool({
		name: "webfetch",
		label: "Web Fetch",
		description: [
			"Fetch content from a URL and return it as Markdown text.",
			"Handles HTML extraction via Mozilla Readability and pagination for large pages.",
			"Inline scripts are listed in an index at the end — use the `script` parameter to read a specific one.",
			"Non-text content (images, PDFs, etc.) is saved to a local file and the path is returned.",
			"Cross-domain redirects are reported back so you can decide whether to follow them.",
		].join(" "),
		promptSnippet: "Fetch and read web page content from a URL",
		promptGuidelines: [
			"Use webfetch to retrieve content from URLs instead of suggesting the user open a browser.",
			"For paginated results, increment `offset` by `returned_length` and call webfetch again until `truncated` is false.",
			"If the page has inline scripts listed at the end, use `script=N` to read one if it might contain relevant data.",
			"If webfetch returns a redirect result, call it again with the `redirect_url`.",
		],
		parameters: Type.Object({
			url: Type.String({
				description: "The URL to fetch.",
			}),
			script: Type.Optional(
				Type.Number({
					description:
						"Index of an inline script to read (from the script index at the end of a previous response). " +
						"Supports the same `offset` and `max_length` pagination as normal page content.",
				}),
			),
			offset: Type.Optional(
				Type.Number({
					description: "Starting character position for pagination. Defaults to 0.",
				}),
			),
			max_length: Type.Optional(
				Type.Number({
					description: `Maximum characters to return in this call. Defaults to ${config.maxPageLength}.`,
				}),
			),
		}),

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const { url, script: scriptIndex, offset = 0, max_length } = params;
			const maxLength = max_length ?? config.maxPageLength;

			// ── Normalize URL ───────────────────────────────────────────────
			let normalizedUrl: string;
			try {
				normalizedUrl = normalizeUrl(url);
			} catch {
				throw new Error(`Invalid URL: ${url}`);
			}

			const optimization = applyFetchOptimizations(normalizedUrl, config);
			normalizedUrl = optimization.url;

			// Temp directory for binary downloads
			const tempDir = getBinaryTempDir();

			// ── Check cache ─────────────────────────────────────────────────
			let entry = cache.get(normalizedUrl);

			if (!entry) {
				onUpdate?.({
					content: [{ type: "text", text: `Fetching ${normalizedUrl}…` }],
					details: {},
				});

				const result = await fetchUrl(normalizedUrl, tempDir, signal);

				// ── Redirect ──────────────────────────────────────────────────
				if (result.type === "redirect") {
					const output: RedirectOutput = {
						redirect: true,
						original_url: result.originalUrl,
						redirect_url: result.redirectUrl,
						status_code: result.statusCode,
						message:
							"This URL redirects to a different domain. " +
							"Call webfetch again with `redirect_url` to fetch the content.",
					};
					return {
						content: [{ type: "text", text: formatRedirectResult(output) }],
						details: output,
					};
				}

				// ── Binary ────────────────────────────────────────────────────
				if (result.type === "binary") {
					const output: BinaryOutput = {
						file_path: result.filePath,
						content_type: result.contentType,
						url: result.url,
					};
					return {
						content: [{ type: "text", text: formatBinaryResult(output) }],
						details: output,
					};
				}

				// ── Process text content ──────────────────────────────────────
				onUpdate?.({
					content: [{ type: "text", text: "Processing content…" }],
					details: {},
				});

				if (result.contentType === "text/html") {
					const processed = await processHtmlWithOptimizations({
						url: normalizedUrl,
						html: result.content,
						config,
						defaultProcess: () => processHtml(result.content, normalizedUrl),
					});
					entry = { markdown: processed.markdown, scripts: processed.scripts };
				} else {
					entry = { markdown: processPlainText(result.content), scripts: [] };
				}

				cache.set(normalizedUrl, entry);
			}

			// ── Script read ─────────────────────────────────────────────────
			if (scriptIndex !== undefined) {
				const script = entry.scripts.find((s) => s.index === scriptIndex);
				if (!script) {
					throw new Error(
						`Script ${scriptIndex} not found. Available indices: ${entry.scripts.map((s) => s.index).join(", ") || "none"}`,
					);
				}
				const total = script.content.length;
				const slice = script.content.slice(offset, offset + maxLength);
				const truncated = offset + maxLength < total;
				const output: TextOutput = {
					content: slice,
					truncated,
					total_length: total,
					offset,
					returned_length: slice.length,
					url: normalizedUrl,
				};
				return {
					content: [{ type: "text", text: formatScriptResult(normalizedUrl, scriptIndex, output) }],
					details: output,
				};
			}

			// ── Pagination ───────────────────────────────────────────────────
			const totalLength = entry.markdown.length;
			const slice = entry.markdown.slice(offset, offset + maxLength);
			const truncated = offset + maxLength < totalLength;

			const output: TextOutput = {
				content: slice,
				truncated,
				total_length: totalLength,
				offset,
				returned_length: slice.length,
				url: normalizedUrl,
			};

			return {
				content: [{ type: "text", text: formatTextResult(output, entry.scripts) }],
				details: output,
			};
		},

		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			let line = theme.fg("toolTitle", theme.bold("webfetch "));
			line += theme.fg("accent", args.url ?? "");
			if (args.script !== undefined) line += theme.fg("muted", ` · script=${args.script}`);
			if (args.offset) line += theme.fg("dim", ` · offset=${args.offset}`);
			text.setText(line);
			return text;
		},

		renderResult(result, options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);

			if (options.isPartial) {
				text.setText(theme.fg("muted", "Fetching…"));
				return text;
			}

			if (context.isError || !result.details) {
				const raw = result.content.find((c) => c.type === "text")?.text ?? "";
				text.setText(theme.fg("error", raw));
				return text;
			}

			const details = result.details as TextOutput | BinaryOutput | RedirectOutput;

			// Redirect
			if ("redirect" in details) {
				text.setText(
					theme.fg("warning", `↪ REDIRECT ${details.status_code}: `) +
					theme.fg("accent", details.redirect_url),
				);
				return text;
			}

			// Binary
			if ("file_path" in details) {
				text.setText(
					theme.fg("success", "✓ ") +
					theme.fg("muted", details.content_type) +
					theme.fg("dim", ` → ${details.file_path}`),
				);
				return text;
			}

			// Text result
			const allLines = details.content.split("\n");
			const MAX_COLLAPSED = 10;
			const maxLines = options.expanded ? allLines.length : MAX_COLLAPSED;
			const displayLines = allLines.slice(0, maxLines);
			const remaining = allLines.length - maxLines;

			const header =
				theme.fg("dim", details.url) +
				(details.truncated
					? theme.fg("muted", ` · ${details.returned_length.toLocaleString()} / ${details.total_length.toLocaleString()} chars`)
					: theme.fg("muted", ` · ${details.total_length.toLocaleString()} chars`));

			let body = "\n" + displayLines.map((l) => theme.fg("toolOutput", l)).join("\n");

			if (remaining > 0) {
				body += theme.fg("muted", `\n… (${remaining} more lines, `) + keyHint("app.tools.expand", "to expand") + theme.fg("muted", ")");
			}

			text.setText(header + body);
			return text;
		},
	});
}
