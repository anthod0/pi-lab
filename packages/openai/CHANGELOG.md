# Changelog

## Unreleased

### Fixed

- Preserve original OpenAI output items in session entries and replay them on same-model requests without modifying assistant messages or adding summaries.
- Retain streamed search calls and citations when the terminal response contains an empty output array.
- Keep cache-warming replay consistent and isolate overlapping response streams, including streams spanning turn boundaries.

## [0.1.0] - 2026-10-23

### Added

- Direct TypeScript source distribution with bundled private utils source, loaded by Pi without compilation or a separate utils publication; tests are excluded.
- Global and project configuration for OpenAI ChatGPT Fast requests and native Web Search.
- Configuration and eligibility rules that standalone `websearch` also implements independently, yielding to enabled native search without package coupling or extension communication.
- Session-local `/fast` controls, branch-aware restoration and Fast status display.
- Native search injection into main-model requests, search activity status and saved Markdown source links using public Pi extension hooks.
