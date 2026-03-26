# Changelog

All notable changes to Pedimap 2 are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

_Placeholder: features and fixes merged to main but not yet released._

---

## [2.1.0] — 2026-03-26

### Changed
- Migrated from Tauri 1.x to Tauri 2.x (wry 0.54, webkit2gtk 4.1).
- Replaced allowlist with granular capabilities in `src-tauri/capabilities/`.
- Shell, dialog, and filesystem features moved to dedicated Tauri 2 plugins.

### Added
- Linux AppImage and .deb builds re-enabled in CI and release workflow.
- `default.json` capability with scoped shell:allow-execute for the sidecar.

### Fixed
- `@tauri-apps/api/tauri` dynamic import updated to `@tauri-apps/api/core`.
- `fileDropEnabled` renamed to `dragDropEnabled` in tauri.conf.json.
- Sidecar staging path corrected to `src-tauri/binaries/` to match Tauri 2 externalBin resolution.

---

## [2.0.0] — 2025-01-01

_Placeholder: initial public release notes for Pedimap 2.0.0._

### Added
- _Placeholder: initial feature list for the 2.0.0 release._
