# Changelog

All notable changes to Pedimap 2 are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The release workflow copies the section whose heading matches the release
version (for example `## [2.1.2]`) into the "What's new" part of the GitHub
release notes, so every release needs its own section here before it is tagged.

## [Unreleased]

### Added
- **Fit to window** toolbar button (shortcut: **F**) brings the whole pedigree
  back into view after you have panned or zoomed away.
- In the details panel, ancestors, descendants and siblings can be expanded
  into a list of names; click a name to select that individual.
- **⤓ Export .dat** toolbar button. It saves the whole population, or, while a
  subpopulation is shown, just that subpopulation (suggested file name
  `<population>_<focal>_subpop.dat`). Parents outside the subpopulation are
  included as founder rows so no pedigree link is lost; choose **Replace
  outside parents with unknown** for a strictly closed set. The file's header
  notes where it came from and how it was selected.

### Changed
- The details panel shows an individual's traits directly under its parents,
  above the relatives.

### Fixed
- Older Pedimap files with accented names (such as "Élise") now open correctly.
  Files saved by Pedimap 1.x on Windows often use the older Windows-1252 text
  encoding; Pedimap 2 now recognizes it, keeps every name intact so parent
  links still match, and shows a short notice when it was used. Exported
  files are always saved as UTF-8.
- Switching between top-to-bottom and left-to-right now re-centers the
  pedigree in the window instead of leaving it partly off screen.
- `.dat` export (`/api/export/dat`) works; it always failed before. The file
  keeps the header settings, every trait column, `*SELF` / `*DH` / `*MUT` /
  `*VP` descent, markers and IBD data, and reads back into Pedimap 2 unchanged.
- Marker color codes in `.dat` files are now kept instead of being dropped on
  load, so they also survive JSON export and import.

## [2.1.2] — 2026-10-06

_2.1.1 was built but never released (macOS backend failed to start)._

### Fixed
- **Mac users:** 2.1.0 did not start on Macs; 2.1.2 fixes this. It showed
  "Cannot reach the Pedimap backend service" and could not load any data.
  Please download and install 2.1.2 yourself once.
- **Intel Macs:** version 2.1.0 could not start on Intel Macs. This release
  fixes it; please install it manually.
- Quitting Pedimap 2 now also stops its background service, which previously
  kept running on macOS and Linux.

### Added
- Pedimap 2 can now tell you when a new version is available and install it.
  You can also check at any time from **ⓘ About → Check for updates**.

### Changed
- Release downloads now have clear names such as
  `Pedimap2-2.1.2-macOS-AppleSilicon.dmg`, and every release page starts with
  a "Which file do I need?" table.
- Each release contains files for one version only, plus `SHA256SUMS.txt`
  checksums for verifying downloads.
- The macOS Intel installer is built on a native Intel machine, and each Mac
  installer is checked to contain only code for its kind of Mac.
- Before any release is published, every installer is test-started to make
  sure Pedimap 2's background service actually runs.

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

[Unreleased]: https://github.com/Fresnedo-Lab/pedimap2/compare/v2.1.2...HEAD
[2.1.2]: https://github.com/Fresnedo-Lab/pedimap2/compare/v2.1.0...v2.1.2
[2.1.0]: https://github.com/Fresnedo-Lab/pedimap2/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/Fresnedo-Lab/pedimap2/releases/tag/v2.0.0
