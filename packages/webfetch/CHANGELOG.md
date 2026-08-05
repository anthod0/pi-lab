# Changelog

All notable changes to `@pi-lab/webfetch` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.1.0] - 2026-08-05

### Added

- Added Reddit permalink optimization using Atom RSS for post bodies and comments, Embed for media and displayed comment counts, and oEmbed as a final metadata fallback.
- Added direct MP4 links for supported X and Reddit video posts, including highest-resolution selection and focal-post association.
- Added textual handling for JSON, Atom, RSS, and XML MIME types.

### Changed

- Reddit results use a canonical post-ID memory cache key with a one-hour TTL to reduce anonymous rate-limit pressure.
- Reddit video cache lifetimes are capped by signed media URL expiry.

### Fixed

- Fetch direct media URLs as binary files instead of attempting text extraction.

## [1.0.5] - 2026-08-05

### Fixed

- Widened the supported `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` peer dependency ranges to `>=0.80.3 <1`, preventing installation conflicts with newer pi releases. ([#4](https://github.com/anthod0/pi-lab/issues/4))

[Unreleased]: https://github.com/anthod0/pi-lab/compare/webfetch@1.1.0...HEAD
[1.1.0]: https://github.com/anthod0/pi-lab/compare/webfetch@1.0.5...webfetch@1.1.0
[1.0.5]: https://github.com/anthod0/pi-lab/compare/webfetch@1.0.4...webfetch@1.0.5
