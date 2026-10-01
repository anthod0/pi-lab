import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_MAX_MEDIA_PER_SEARCH, DEFAULT_XSEARCH_MODEL, loadXSearchConfig } from "./config.js";

test("loadXSearchConfig keeps the xAI defaults", () => {
  const config = loadXSearchConfig({});
  assert.equal(config.model, DEFAULT_XSEARCH_MODEL);
  assert.equal(config.backend, "auto");
  assert.equal(config.enableImageUnderstanding, false);
  assert.equal(config.enableVideoUnderstanding, false);
  assert.equal(config.maxMediaPerSearch, DEFAULT_MAX_MEDIA_PER_SEARCH);
});

test("loadXSearchConfig reads the xsearch block", () => {
  const config = loadXSearchConfig({
    xsearch: {
      model: "anthropic/claude-haiku-4-5-20251001",
      backend: "twitterapi",
      enableImageUnderstanding: true,
      enableVideoUnderstanding: true,
      maxMediaPerSearch: 2,
    },
  });
  assert.equal(config.model, "anthropic/claude-haiku-4-5-20251001");
  assert.equal(config.backend, "twitterapi");
  assert.equal(config.enableImageUnderstanding, true);
  assert.equal(config.enableVideoUnderstanding, true);
  assert.equal(config.maxMediaPerSearch, 2);
});

test("loadXSearchConfig ignores malformed values instead of throwing", () => {
  const config = loadXSearchConfig({
    xsearch: {
      model: "   ",
      backend: "nonsense",
      maxMediaPerSearch: -3,
      enableImageUnderstanding: "yes",
      enableVideoUnderstanding: 1,
    },
  });
  assert.equal(config.model, DEFAULT_XSEARCH_MODEL);
  assert.equal(config.backend, "auto");
  assert.equal(config.maxMediaPerSearch, DEFAULT_MAX_MEDIA_PER_SEARCH);
  assert.equal(config.enableImageUnderstanding, false);
  assert.equal(config.enableVideoUnderstanding, false);
});

test("loadXSearchConfig caps maxMediaPerSearch", () => {
  assert.equal(loadXSearchConfig({ xsearch: { maxMediaPerSearch: 500 } }).maxMediaPerSearch, 20);
  assert.equal(loadXSearchConfig({ xsearch: { maxMediaPerSearch: 0 } }).maxMediaPerSearch, 0);
  assert.equal(loadXSearchConfig({ xsearch: { maxMediaPerSearch: 1.5 } }).maxMediaPerSearch, DEFAULT_MAX_MEDIA_PER_SEARCH);
});

test("loadXSearchConfig tolerates a non-object xsearch block", () => {
  assert.equal(loadXSearchConfig({ xsearch: "nope" }).model, DEFAULT_XSEARCH_MODEL);
  assert.equal(loadXSearchConfig({ xsearch: [] }).model, DEFAULT_XSEARCH_MODEL);
});

test("a ceiling caps maxPages rather than being raised to it", () => {
  const capped = loadXSearchConfig({ xsearch: { maxPages: 5, maxPagesCeiling: 2 } });
  assert.equal(capped.maxPagesCeiling, 2);
  assert.equal(capped.maxPages, 2, "the base budget is clamped down to the ceiling");

  const normal = loadXSearchConfig({ xsearch: { maxPages: 3, maxPagesCeiling: 10 } });
  assert.equal(normal.maxPages, 3);
  assert.equal(normal.maxPagesCeiling, 10);

  const defaults = loadXSearchConfig({});
  assert.equal(defaults.maxPages, 5);
  assert.equal(defaults.maxPagesCeiling, 20);
});
