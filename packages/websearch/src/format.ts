import type { NormalizedSearchResult, SearchDetails } from "./exa.js";

const MAX_FALLBACK_TEXT_LENGTH = 500;

export function formatSearchResults(details: SearchDetails): string {
  const lines: string[] = [
    `Query: ${details.query}`,
    `Type: ${details.type}`,
    `Results: ${details.resultCount}`,
  ];

  details.results.forEach((result, index) => {
    lines.push("", formatResult(index + 1, result));
  });

  return lines.join("\n");
}

function formatResult(index: number, result: NormalizedSearchResult): string {
  const lines = [`${index}. ${result.title}`, `   URL: ${result.url}`];

  if (result.publishedDate) lines.push(`   Published: ${result.publishedDate}`);
  if (result.author) lines.push(`   Author: ${result.author}`);

  if (result.highlights.length > 0) {
    lines.push("   Highlights:");
    lines.push(...result.highlights.map((highlight) => `   - ${highlight}`));
  } else if (result.text) {
    lines.push(`   Text: ${truncate(result.text, MAX_FALLBACK_TEXT_LENGTH)}`);
  }

  return lines.join("\n");
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}
