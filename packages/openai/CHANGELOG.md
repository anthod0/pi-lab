# Changelog

## [Unreleased]

## [1.1.0] - 2026-11-14

### Added

- Fast mode for OpenAI API-key connections and OpenAI Codex, including `/fast` controls and response-tier status.
- Optional `openai.optimizeLatency` setting to reduce repeated history uploads and request latency in long conversations when signed in with ChatGPT.

## [1.0.0] - 2026-11-06

### Added

- Image generation and editing through Codex OAuth or the OpenAI Images API, available with any chat model.
- Batch generation, output formats, sizes and editing options supported by the selected backend and model.
- Save images to new files without overwriting existing files, report actual raster dimensions, and support cancellation.

### Changed

- Image generation is available as a replacement for the deprecated `@pi-lab/codex-image` CLI integration. Configure `openai.imageGeneration` and remove the old extension before reloading.

## [0.1.2] - 2026-10-25

### Changed

- Read the `openai` section from Pi's user and project `settings.json` files instead of separate `openai.json` files.

### Fixed

- Apply Fast mode consistently to eligible requests and omit the service tier when Fast mode is off.
- Preserve native search actions and citations across subsequent requests and session reloads without changing assistant answers.
- Retain streamed search records even when the final response contains an empty output array, and prevent overlapping requests from mixing their records.
- Include recorded native search actions and available source data in context-compaction input while respecting branch boundaries and context edits.

## [0.1.0] - 2026-10-23

### Added

- Direct TypeScript source distribution with bundled private utils source, loaded by Pi without compilation or a separate utils publication; tests are excluded.
- Global and project configuration for OpenAI ChatGPT Fast requests and native Web Search.
- Configuration and eligibility rules that standalone `websearch` also implements independently, yielding to enabled native search without package coupling or extension communication.
- Session-local `/fast` controls, branch-aware restoration and Fast status display.
- Native search injection into main-model requests, search activity status and saved Markdown source links using public Pi extension hooks.
