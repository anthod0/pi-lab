import type { XSearchDetails } from "./xai.js";

export function formatXSearchResults(details: XSearchDetails): string {
  const lines = [
    `Query: ${details.query}`,
    `Model: ${details.model}`,
    `X Search Calls: ${details.xSearchCalls ?? 0}`,
    `Citations: ${details.citations.length}`,
    "",
    "## Answer",
    "",
    details.text || "No answer text returned.",
  ];

  if (details.citations.length > 0) {
    lines.push("", "## Sources", "");
    details.citations.forEach((citation, index) => {
      lines.push(`${index + 1}. ${citation}`);
    });
  }

  return lines.join("\n");
}
