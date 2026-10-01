import assert from "node:assert/strict";
import test from "node:test";

import { formatXSearchResults } from "./format.js";

test("formats the tool contract", () => {
  const markdown = formatXSearchResults({
    query: "what is new",
    model: "grok-4-1-fast-non-reasoning",
    text: "Grok shipped.",
    citations: ["https://x.com/a/status/1", "https://x.com/b/status/2"],
    xSearchCalls: 2,
  });

  assert.equal(
    markdown,
    [
      "Query: what is new",
      "Model: grok-4-1-fast-non-reasoning",
      "X Search Calls: 2",
      "Citations: 2",
      "",
      "## Answer",
      "",
      "Grok shipped.",
      "",
      "## Sources",
      "",
      "1. https://x.com/a/status/1",
      "2. https://x.com/b/status/2",
    ].join("\n"),
  );
});

test("omits Sources when there are no citations and falls back for empty text", () => {
  const markdown = formatXSearchResults({
    query: "q",
    model: "m",
    text: "",
    citations: [],
  });
  assert.match(markdown, /No answer text returned\./);
  assert.doesNotMatch(markdown, /## Sources/);
});

test("appends a Notes section only when notes are present", () => {
  const withoutNotes = formatXSearchResults({ query: "q", model: "m", text: "t", citations: [] });
  assert.doesNotMatch(withoutNotes, /## Notes/);

  const withNotes = formatXSearchResults({
    query: "q",
    model: "m",
    text: "t",
    citations: ["https://x.com/a/status/1"],
    notes: ["first note", "second note"],
  });
  assert.ok(withNotes.endsWith("## Notes\n\n- first note\n- second note"));
});
