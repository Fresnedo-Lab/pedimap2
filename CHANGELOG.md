# Changelog

All notable changes to Pedimap 2 are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The release workflow copies the section whose heading matches the release
version (for example `## [2.1.1]`) into the "What's new" part of the GitHub
release notes, so every release needs its own section here before it is tagged.

## [Unreleased]

### Changed
- Release downloads now have descriptive names such as
  `Pedimap2-2.1.1-macOS-AppleSilicon.dmg`, and every release page starts with
  a "Which file do I need?" table.
- The macOS Intel installer is built on a native Intel machine, so its bundled
  backend runs on Intel Macs.
- Releases include `SHA256SUMS.txt` for verifying downloads, plus the files
  needed for automatic updates (`latest.json`, `-update.app.tar.gz`, `.sig`).

## [2.1.0] — 2026-08-05

### Added
- Legacy Pedimap 1.x `.dat` import: header keywords, pedigree with trait
  columns, uniparental descent (`*SELF`, `*DH`, `*MUT`, `*VP`), markers,
  linkage groups and IBD probabilities. `.pmp` files are read for the
  population name.
- **Load Example Data** toolbar item with the original Pedimap apple pedigree.
- Pedigree orientation toggle (top-to-bottom or left-to-right), remembered
  per view.
- Trait values that are color names (for example `Red`) are drawn in that color.
- Linux installers (AppImage, `.deb`, `.rpm`) are available again.
- User manual (PDF) attached to each release.

### Changed
- Moved from Tauri 1.x to Tauri 2.x, with permissions declared as capabilities.
- Individuals are ordered so that parents always come before their children,
  regardless of the order in the input file.
- The backend reports the same version as the app.

### Fixed
- Loading a new dataset now refreshes the sidebar, the graph and the
  individual list together.
- All founders share the first generation in the layout.
- JSON export/import no longer discards IBD data.
- The app waits for the backend to be ready before loading data, and shows an
  error if it does not start.
- Hover tooltips render correctly.

## [2.0.0] — 2026-03-18

### Added
- First release of Pedimap 2, a cross-platform reimplementation of Pedimap 1.x.
- Interactive pedigree graph with pan, zoom and drag.
- Trait coloring with continuous gradients and qualitative palettes.
- Individual search, selection and a details panel.
- JSON import and export.
- Demo apple breeding dataset.
- Windows installers (`.exe` and `.msi`).

[Unreleased]: https://github.com/Fresnedo-Lab/pedimap2/compare/v2.1.0...HEAD
[2.1.0]: https://github.com/Fresnedo-Lab/pedimap2/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/Fresnedo-Lab/pedimap2/releases/tag/v2.0.0
