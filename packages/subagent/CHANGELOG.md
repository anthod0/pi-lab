# Changelog

All notable changes to `@pi-lab/subagent` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.0.1] - 2026-10-02

### Changed

- Updated host dependencies for Pi 1.0 and migrated tool schemas to TypeBox 1.x.

### Fixed

- Updated child-agent usage aggregation for Pi 1.0's required usage fields, including reasoning and one-hour cache writes.

## [1.0.0] - 2026-09-04

### Added

- Added a minimal synchronous subagent tool backed by headless pi processes.
- Added native parallel execution through Pi's tool concurrency.
- Added cancellation and child process tree cleanup.
- Added compact and expanded TUI rendering.

[Unreleased]: https://github.com/anthod0/pi-lab/compare/subagent@1.0.1...HEAD
[1.0.1]: https://github.com/anthod0/pi-lab/compare/subagent@1.0.0...subagent@1.0.1
[1.0.0]: https://github.com/anthod0/pi-lab/releases/tag/subagent@1.0.0
