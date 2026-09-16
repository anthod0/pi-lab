# Changelog

All notable changes to `@pi-lab/codex-image` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.2.0] - 2026-09-16

### Changed

- Return only the saved image path, without image previews or result metadata.

## [1.1.0] - 2026-09-10

### Added

- Stream image prompts in the tool call UI as arguments arrive, and keep the complete prompt visible during image generation. Hide the prompt when execution ends, preserving the existing saved path and image preview rendering.
- Tests for streaming prompts, completed and failed calls, incomplete arguments, and long Chinese prompt wrapping.

[Unreleased]: https://github.com/anthod0/pi-lab/compare/codex-image@1.2.0...HEAD
[1.2.0]: https://github.com/anthod0/pi-lab/compare/codex-image@1.1.0...codex-image@1.2.0
[1.1.0]: https://github.com/anthod0/pi-lab/compare/codex-image@1.0.0...codex-image@1.1.0
