# Changelog

All notable changes to `@pi-lab/env` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- Load global env values before later extensions initialize. Keep shell
  precedence and load trusted project settings at `session_start`.
- Preserve changes and deletions of injected values across session events.
- Read configuration before applying values to avoid partial loads on failure.

## [1.0.5] - 2026-10-02

### Changed

- Updated the host peer dependency declaration and development toolchain for Pi 1.0.

## [1.0.4] - 2026-08-05

### Fixed

- Widened the supported `@earendil-works/pi-coding-agent` peer dependency range to `>=0.80.3 <1`, preventing installation conflicts with pi 0.81 and newer. ([#4](https://github.com/anthod0/pi-lab/issues/4))

[Unreleased]: https://github.com/anthod0/pi-lab/compare/env@1.0.5...HEAD
[1.0.5]: https://github.com/anthod0/pi-lab/compare/env@1.0.4...env@1.0.5
[1.0.4]: https://github.com/anthod0/pi-lab/compare/env@1.0.3...env@1.0.4
