# Changelog

All notable changes to `@pi-lab/webfetch` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Added Reddit permalink optimization using Atom RSS for post bodies and comments, Embed for media and displayed comment counts, and oEmbed as a final metadata fallback.
- Added textual handling for JSON, Atom, RSS, and XML MIME types.

### Changed

- Reddit results use a canonical post-ID memory cache key with a one-hour TTL to reduce anonymous rate-limit pressure.

## [1.0.5] - 2026-08-05

### Fixed

- Widened the supported `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` peer dependency ranges to `>=0.80.3 <1`, preventing installation conflicts with newer pi releases. ([#4](https://github.com/anthod0/pi-lab/issues/4))

[Unreleased]: https://github.com/anthod0/pi-lab/compare/webfetch@1.0.5...HEAD
[1.0.5]: https://github.com/anthod0/pi-lab/compare/webfetch@1.0.4...webfetch@1.0.5
