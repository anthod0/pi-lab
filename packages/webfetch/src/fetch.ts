import { writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { normalizeUrl } from "./normalize.js";

// ─── Result types ────────────────────────────────────────────────────────────

export interface TextResult {
	type: "text";
	content: string;
	contentType: string;
	url: string;
}

export interface BinaryResult {
	type: "binary";
	filePath: string;
	contentType: string;
	url: string;
}

export interface RedirectResult {
	type: "redirect";
	originalUrl: string;
	redirectUrl: string;
	statusCode: number;
}

export type FetchResult = TextResult | BinaryResult | RedirectResult;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Determine if two URLs are on the same domain.
 * Same domain = same protocol + same port + same hostname (ignoring www prefix).
 */
function isSameDomain(a: string, b: string): boolean {
	try {
		const u1 = new URL(a);
		const u2 = new URL(b);
		if (u1.protocol !== u2.protocol) return false;
		if (u1.port !== u2.port) return false;
		const h1 = u1.hostname.replace(/^www\./, "");
		const h2 = u2.hostname.replace(/^www\./, "");
		return h1 === h2;
	} catch {
		return false;
	}
}

const TEXT_CONTENT_TYPES = new Set([
	"application/atom+xml",
	"application/json",
	"application/rss+xml",
	"application/xml",
	"text/xml",
]);

export function isTextContentType(contentType: string): boolean {
	const baseContentType = contentType.split(";")[0].trim().toLowerCase();
	return baseContentType.startsWith("text/") || TEXT_CONTENT_TYPES.has(baseContentType);
}

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
	"image/jpeg": ".jpg",
	"image/png": ".png",
	"image/gif": ".gif",
	"image/webp": ".webp",
	"image/svg+xml": ".svg",
	"application/pdf": ".pdf",
	"application/zip": ".zip",
	"application/json": ".json",
	"video/mp4": ".mp4",
	"audio/mpeg": ".mp3",
};

function extForContentType(contentType: string): string {
	return CONTENT_TYPE_EXTENSIONS[contentType] ?? ".bin";
}

// ─── Main fetch function ──────────────────────────────────────────────────────

/**
 * Fetch a URL, following same-domain redirects automatically.
 * Cross-domain redirects are returned as RedirectResult for the LLM to handle.
 * Binary content is saved to tempDir and returned as BinaryResult.
 */
export async function fetchUrl(
	normalizedUrl: string,
	tempDir: string,
	signal?: AbortSignal,
	maxRedirects = 10,
): Promise<FetchResult> {

	let currentUrl = normalizedUrl;

	for (let hop = 0; hop <= maxRedirects; hop++) {
		const response = await fetch(currentUrl, {
			signal,
			redirect: "manual", // Handle redirects manually
			headers: {
				Accept: "text/markdown, text/plain, text/html, */*",
				"User-Agent": "pi/webfetch",
			},
		});

		// ── Redirect ──────────────────────────────────────────────────────────
		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get("location");
			if (!location) {
				throw new Error(`Redirect ${response.status} with no Location header`);
			}

			// Resolve relative redirects against current URL
			let redirectUrl: string;
			try {
				redirectUrl = new URL(location, currentUrl).toString();
			} catch {
				throw new Error(`Invalid redirect location: ${location}`);
			}

			if (isSameDomain(currentUrl, redirectUrl)) {
				currentUrl = normalizeUrl(redirectUrl);
				continue;
			} else {
				// Cross-domain: let the LLM decide
				return {
					type: "redirect",
					originalUrl: normalizedUrl,
					redirectUrl,
					statusCode: response.status,
				};
			}
		}

		// ── Error responses ───────────────────────────────────────────────────
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const rawContentType = response.headers.get("content-type") ?? "";
		const baseContentType = rawContentType.split(";")[0].trim().toLowerCase();

		// ── Text content ──────────────────────────────────────────────────────
		if (isTextContentType(baseContentType)) {
			const text = await response.text();
			return {
				type: "text",
				content: text,
				contentType: baseContentType,
				url: currentUrl,
			};
		}

		// ── Binary content ────────────────────────────────────────────────────
		await mkdir(tempDir, { recursive: true });
		const ext = extForContentType(baseContentType);
		const filename = `webfetch-${Date.now()}${ext}`;
		const filePath = join(tempDir, filename);

		const buffer = await response.arrayBuffer();
		await writeFile(filePath, Buffer.from(buffer));

		return {
			type: "binary",
			filePath,
			contentType: baseContentType,
			url: currentUrl,
		};
	}

	throw new Error(`Too many redirects (max ${maxRedirects})`);
}
