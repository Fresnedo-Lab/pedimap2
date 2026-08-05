# 🌿 Pedimap 2

> **Modern multiplatform pedigree visualization for plant breeders.**
> Spiritual successor to [Pedimap 1.x](https://github.com/PBR/Pedimap) (Voorrips *et al.* 2012, *J. Hered.*).

[![CI](https://github.com/Fresnedo-Lab/pedimap2/actions/workflows/ci.yml/badge.svg)](https://github.com/Fresnedo-Lab/pedimap2/actions/workflows/ci.yml)
[![Release](https://github.com/Fresnedo-Lab/pedimap2/actions/workflows/release.yml/badge.svg)](https://github.com/Fresnedo-Lab/pedimap2/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Pedimap 2 is a ground-up reimplementation of Pedimap for modern operating
systems. The original is Windows-only and its C++ Builder 6 source no longer
compiles; this project rebuilds the same capabilities on a cross-platform stack
while remaining compatible with existing Pedimap data files.

---

## 📥 Installation

Download the installer for your platform from the
[**Releases page**](https://github.com/Fresnedo-Lab/pedimap2/releases).
No Python, Node, or Rust installation is needed — everything is bundled.

| Platform | File |
|----------|------|
| Windows 10/11 (64-bit) | `Pedimap2_*_x64-setup.exe` or `Pedimap2_*_x64_en-US.msi` |
| macOS Apple Silicon | `Pedimap2_*_aarch64.dmg` |
| macOS Intel | `Pedimap2_*_x64.dmg` |
| Linux x86_64 | `pedimap2_*_amd64.AppImage` or `pedimap2_*_amd64.deb` |

**Linux:** mark the AppImage executable before first run —
`chmod +x pedimap2_*.AppImage`

**macOS:** if you see a Gatekeeper warning on an unsigned build, right-click
the app → Open on first launch.

### Try it immediately

Click **Load Example Data** in the toolbar. This loads the original Pedimap
apple pedigree — 8 individuals across 4 generations, with a qualitative trait
(`Color`), a continuous trait (`Length`), 5 markers across 3 linkage groups,
and precalculated IBD probabilities.

---

## ✨ Current capabilities

| Feature | Status |
|---------|--------|
| Interactive pedigree graph — pan, zoom, drag | ✅ |
| Generation-aware hierarchical layout | ✅ |
| Orientation toggle — top-to-bottom / left-to-right | ✅ |
| Trait coloring — continuous gradient and qualitative palette | ✅ |
| Semantic color names — a `Red` trait value renders red | ✅ |
| Legacy `.dat` import — pedigree, traits, markers, IBD | ✅ |
| Bundled example dataset | ✅ |
| Individual search and selection | ✅ |
| Hover details — parents, generation, trait values | ✅ |
| JSON export / import round-trip | ✅ |
| Cross-platform native installers | ✅ |
| Offline-first — all computation is local | ✅ |

### Parsed but not yet visualized

The `.dat` parser reads these completely and they survive a JSON round-trip,
but no interface renders them yet:

- IBD probabilities per linkage group and position
- Observed marker alleles with per-score color codes
- Linkage group maps and founder allele definitions

### Not yet implemented

These are core to Pedimap 1.x and are the focus of ongoing work:

- View tabs — multiple customizable views per population
- Population panel and subpopulations
- Select Relatives — build subpopulations by pedigree relationship
- Information panel — persistent detail view
- IBD haplotype rectangles and most-probable-allele display
- `.pmp` subpopulations and saved views (currently only the population name is read)

---

## 📂 File format support

### Input

| Extension | Support |
|-----------|---------|
| `.dat` | Full — header keywords, pedigree with trait columns, uniparental descent (`*SELF`, `*DH`, `*MUT`, `*VP`), linkage groups, marker alleles, IBD probability matrices |
| `.pmp` | Partial — population name only; subpopulations and views are not yet modeled |
| `.json` | Full — Pedimap 2 native format |

The `.dat` parser handles the format's real-world quirks, including
end-of-line comments, both `;` and `/` as linkage-group annotation
delimiters, case-sensitive name matching, quoted names containing spaces,
and pedigrees listed in any order (individuals are topologically sorted so
parents always precede their children).

See [`docs/reference/dat-format.md`](docs/reference/dat-format.md) for the
full specification.

### Output

| Extension | Route |
|-----------|-------|
| `.json` | `/api/export/json` |
| `.dat` | `/api/export/dat` |

---

## 🛠 Development

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Python | 3.12 | Must match CI; 3.9 will not work |
| Node.js | 22 | |
| Rust | stable | |
| Tauri CLI | ^2 | `cargo install tauri-cli --version "^2" --locked` |

> **Tauri 2 required.** The v1 and v2 CLIs are separate crates and their
> config schemas are incompatible.

### Setup

```bash
git clone https://github.com/Fresnedo-Lab/pedimap2.git
cd pedimap2

# Backend — an isolated virtual environment is required
python3.12 -m venv backend/.venv
source backend/.venv/bin/activate          # Windows: backend\.venv\Scripts\activate
pip install -r backend/requirements.txt pyinstaller

# Frontend
cd frontend && npm install && cd ..
```

> **Why a venv is mandatory:** PyInstaller bundles whichever interpreter it
> runs under. Using a system Python without the backend dependencies installed
> produces a sidecar binary that builds without error but crashes at startup
> with every hidden import missing. `scripts/build-sidecar.sh` refuses to run
> unless `backend/.venv` exists.

### Run

```bash
npm run app:dev     # builds and stages the sidecar, then launches Tauri
```

The Python backend runs as a sidecar on `127.0.0.1:8765`. The frontend polls
`/api/health` and will not issue other requests until the backend is ready.

### Test

```bash
cd backend && python -m pytest tests/ -v      # 36 tests
cd frontend && npm run typecheck && npm run build
cd src-tauri && cargo check
```

### Build installers locally

```bash
npm run app:build
# Output: src-tauri/target/release/bundle/
```

### Release

Push a version tag; GitHub Actions builds all four targets and opens a draft
release.

```bash
# Bump the version in all four files first:
#   package.json · frontend/package.json
#   src-tauri/Cargo.toml · src-tauri/tauri.conf.json
git tag -a v2.1.1 -m "Pedimap 2.1.1"
git push origin main --tags
```

---

## 🏗 Architecture

```
┌──────────────────────────────────────────┐
│  Tauri 2.x shell (Rust)                  │
│  ├─ native dialogs, filesystem access    │
│  └─ spawns and supervises the sidecar    │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  React 18 + TypeScript + Vite      │  │
│  │  vis-network pedigree canvas       │  │
│  └────────────────┬───────────────────┘  │
│                   │ HTTP :8765           │
│  ┌────────────────▼───────────────────┐  │
│  │  FastAPI sidecar (PyInstaller)     │  │
│  │  NetworkX DAG · .dat/.pmp parser   │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

The Python backend ships as a self-contained binary inside the app bundle —
users never install Python.

---

## 📖 Documentation

| Document | Contents |
|----------|----------|
| [`docs/`](docs/) | User manual source |
| [`docs/reference/dat-format.md`](docs/reference/dat-format.md) | `.dat` / `.pmp` format specification |
| [`docs/reference/ui-model.md`](docs/reference/ui-model.md) | Interaction model derived from Pedimap 1.x |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Development workflow and branching |

---

## 🗺 Roadmap

**Next**
- [ ] View tabs with per-view settings
- [ ] Population panel and subpopulations
- [ ] Select Relatives dialog
- [ ] Information panel
- [ ] Full `.pmp` support — subpopulations, saved views, notes

**Then**
- [ ] IBD haplotype rectangles per linkage group
- [ ] Most-probable-allele display with probability thresholds
- [ ] Marker score display with color codes
- [ ] Sex-colored parent connectors (female red, male blue, uniparental purple)
- [ ] Export to SVG / PDF
- [ ] User manual as GitHub Wiki and PDF

**Later**
- [ ] BrAPI integration — pull pedigrees from BreedBase / GRIN
- [ ] Multi-trait comparison view

**Done**
- [x] Tauri 2.x migration — Linux restored as a release target
- [x] Legacy `.dat` parser with full format coverage
- [x] Bundled demo dataset
- [x] macOS signing and notarization in CI
- [x] Automatic update delivery (Tauri updater)

---

## 📖 Citation

If you use Pedimap 2 in published research, please cite both the original
paper and this repository:

> Voorrips RE, Bink MCAM, Van de Weg WE (2012) Pedimap: software for the
> visualization of genetic and phenotypic data in pedigrees. *J. Hered.*
> 103:903–907. doi:10.1093/jhered/ess060

> Fresnedo-Lab (2026) Pedimap 2: modern multiplatform pedigree visualization
> for plant breeding. https://github.com/Fresnedo-Lab/pedimap2

---

## 📄 License

MIT — see [LICENSE](LICENSE).

Pedimap 2 is an independent reimplementation. It reads the Pedimap file
format and reproduces the original's behavior, but shares no code with
Pedimap 1.x, whose source is published without a license at
[PBR/Pedimap](https://github.com/PBR/Pedimap).

---

## Acknowledgements

Pedimap 2 is inspired by the original Pedimap 1.x by Roeland Voorrips,
Marco Bink and Eric van de Weg (Wageningen University & Research). We
gratefully acknowledge their foundational work and the Pedimap community.
