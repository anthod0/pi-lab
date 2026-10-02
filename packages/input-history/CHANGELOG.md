# Changelog

All notable changes to `@pi-lab/input-history` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.0.5] - 2026-10-02

### Changed

- Delegated history navigation to Pi's editor so fullscreen shortcuts, configurable keybindings, and existing custom editors continue to work.

## [1.0.4] - 2026-10-02

### Changed

- Updated host dependencies for Pi 1.0.

### Fixed

- Declared Pi TUI as a host-provided peer dependency instead of bundling a duplicate TUI runtime.

## [1.0.3] - 2026-08-05

### Fixed

- Widened the supported `@earendil-works/pi-coding-agent` peer dependency range to `>=0.80.3 <1`, preventing installation conflicts with newer pi releases. ([#4](https://github.com/anthod0/pi-lab/issues/4))

[Unreleased]: https://github.com/anthod0/pi-lab/compare/input-history@1.0.5...HEAD
[1.0.5]: https://github.com/anthod0/pi-lab/compare/input-history@1.0.4...input-history@1.0.5
[1.0.4]: https://github.com/anthod0/pi-lab/compare/input-history@1.0.3...input-history@1.0.4
[1.0.3]: https://github.com/anthod0/pi-lab/compare/input-history@1.0.2...input-history@1.0.3
