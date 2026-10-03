# Changelog

All notable changes to `@pi-lab/permissions` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.1.0] - 2026-10-03

### Added

- Added **Deny with feedback** to return a user-provided denial reason to the model. ([#8](https://github.com/anthod0/pi-lab/issues/8))
- Added scrollable `write` previews with complete content for new files and unified diffs for existing files, alongside permission options in a single TUI dialog. RPC clients receive the preview in the selection dialog. ([#9](https://github.com/anthod0/pi-lab/issues/9))

## [1.0.4] - 2026-10-02

### Changed

- Updated the host peer dependency declaration and development toolchain for Pi 1.0.
- Removed the unused legacy TypeBox dependency.

## [1.0.3] - 2026-08-05

### Fixed

- Widened the supported `@earendil-works/pi-coding-agent` peer dependency range to `>=0.80.3 <1`, preventing installation conflicts with newer pi releases. ([#4](https://github.com/anthod0/pi-lab/issues/4))

[Unreleased]: https://github.com/anthod0/pi-lab/compare/permissions@1.1.0...HEAD
[1.1.0]: https://github.com/anthod0/pi-lab/compare/permissions@1.0.4...permissions@1.1.0
[1.0.4]: https://github.com/anthod0/pi-lab/compare/permissions@1.0.3...permissions@1.0.4
[1.0.3]: https://github.com/anthod0/pi-lab/compare/permissions@1.0.2...permissions@1.0.3
