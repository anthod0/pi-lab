# Changelog

## [Unreleased]

## [0.1.1] - 2026-10-25

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
