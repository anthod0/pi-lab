# Changelog

All notable changes to `@pi-lab/websearch` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.2.0] - 2026-09-29

### Added

- Added TinyFish Search API support with provider selection through `WEBSEARCH_PROVIDER` or Pi settings.

### Changed

- Removed the public `fresh` parameter and always request fresh content from providers that support freshness controls.
- Changed automatic provider selection priority to Parallel, TinyFish, then Exa, and report a configuration error when no provider key is available.

## [1.1.0] - 2026-09-29

### Added

- Added Parallel Search API support with provider selection through `WEBSEARCH_PROVIDER` or Pi settings.

### Changed

- Replaced provider-specific search modes with the common `fast`, `balanced`, and `deep` types.
- Limited tool parameters to capabilities shared by Exa and Parallel.

## [1.0.4] - 2026-08-05

### Fixed

- Widened the supported `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` peer dependency ranges to `>=0.80.3 <1`, preventing installation conflicts with newer pi releases. ([#4](https://github.com/anthod0/pi-lab/issues/4))

[Unreleased]: https://github.com/anthod0/pi-lab/compare/websearch@1.2.0...HEAD
[1.2.0]: https://github.com/anthod0/pi-lab/compare/websearch@1.1.0...websearch@1.2.0
[1.1.0]: https://github.com/anthod0/pi-lab/compare/websearch@1.0.4...websearch@1.1.0
[1.0.4]: https://github.com/anthod0/pi-lab/compare/websearch@1.0.3...websearch@1.0.4
