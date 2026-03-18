# 🌿 Pedimap 2

> **Modern multiplatform pedigree visualization for plant breeders.**
> Spiritual successor to [Pedimap 1.x](https://www.wur.nl/en/Research-Results/Research-Institutes/plant-research/biometris/software/Pedimap.htm) (Voorrips *et al.* 2012, *J. Hered.*).

[![CI](https://github.com/Fresnedo-Lab/pedimap2/actions/workflows/ci.yml/badge.svg)](https://github.com/Fresnedo-Lab/pedimap2/actions/workflows/ci.yml)
[![Release](https://github.com/Fresnedo-Lab/pedimap2/actions/workflows/release.yml/badge.svg)](https://github.com/Fresnedo-Lab/pedimap2/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **Interactive pedigree DAG** | Pan, zoom, drag — vis-network powered canvas |
| **Trait coloring** | Continuous gradient or qualitative palette per phenotype |
| **Subpopulation builder** | Focal individual + ancestors / descendants / siblings |
| **Click-to-inspect** | Full detail card: parents, traits, SSR markers, stats |
| **`.dat` / `.pmp` import** | Full backward compatibility with original Pedimap datasets |
| **JSON round-trip** | Export / import via open JSON format |
| **Cross-platform** | Native `.msi`, `.dmg`, `.AppImage` installers via Tauri |
| **Offline-first** | No internet connection required — all computation is local |

---

## 📥 Installation

Download the latest installer for your platform from the
[**Releases page**](https://github.com/Fresnedo-Lab/pedimap2/releases).

| Platform | File to download |
|----------|-----------------|
| Windows 10/11 (64-bit) | `Pedimap2_*_x64-setup.exe` |
| macOS Apple Silicon    | `Pedimap2_*_aarch64.dmg` |
| macOS Intel            | `Pedimap2_*_x64.dmg` |
| Linux x86_64           | `pedimap2_*_amd64.AppImage` |

> **macOS note:** On first launch, right-click the app → Open to bypass Gatekeeper
> (unsigned build). For signed/notarized builds, set the `APPLE_*` secrets in your fork.
>
> **Linux note:** Mark the AppImage executable before running:
> `chmod +x pedimap2_*.AppImage && ./pedimap2_*.AppImage`

---

## 🏗 Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Tauri Shell  (Rust)                                         │
│  • Native window · file dialogs · process lifecycle          │
│  • Spawns Python sidecar on startup                          │
└────────────────────────┬─────────────────────────────────────┘
                         │  Tauri IPC commands
┌────────────────────────▼─────────────────────────────────────┐
│  React 18 + TypeScript  (Vite · vis-network)                 │
│  • PedigreeCanvas   — interactive DAG                        │
│  • IndividualPanel  — click-to-inspect detail card           │
│  • Sidebar          — searchable individual list + legend    │
└────────────────────────┬─────────────────────────────────────┘
                         │  REST JSON  (localhost:5173)
┌────────────────────────▼─────────────────────────────────────┐
│  FastAPI Backend  (Python 3.10+ · bundled by PyInstaller)    │
│  • 14 REST endpoints for all pedigree operations             │
│  • PedigreeEngine — NetworkX DAG · graph queries · layout    │
│  • PmpParser      — full .dat / .pmp format support          │
└──────────────────────────────────────────────────────────────┘
```

---

## 🛠 Development setup

### Prerequisites

| Tool       | Version  | Install |
|------------|----------|---------|
| Python     | ≥ 3.10   | [python.org](https://python.org) |
| Node.js    | ≥ 18     | [nodejs.org](https://nodejs.org) |
| Rust       | stable   | `curl https://sh.rustup.rs -sSf \| sh` |
| Tauri CLI  | ≥ 1.6    | `cargo install tauri-cli` |

```bash
# 1. Clone
git clone https://github.com/Fresnedo-Lab/pedimap2.git
cd pedimap2

# 2. Backend
pip install -r backend/requirements.txt

# 3. Frontend
cd frontend && npm install && cd ..

# 4. Dev mode (hot-reload)
#    Terminal A — Python backend:
cd backend && python api.py
#    Terminal B — Tauri dev window:
cargo tauri dev
```

---

## 📦 Building a release installer

```bash
# Step 1 — Build the Python sidecar binary
# Linux / macOS:
chmod +x build_sidecar.sh && ./build_sidecar.sh

# Windows (PowerShell):
.\build_sidecar.ps1

# Step 2 — Build the Tauri installer
cargo tauri build
# Installers appear in:  src-tauri/target/release/bundle/
```

Or push a version tag to trigger the GitHub Actions release workflow, which
builds all platforms automatically:

```bash
git tag v2.0.1 && git push origin v2.0.1
```

---

## 📂 File format support

### Input
| Extension | Description |
|-----------|-------------|
| `.dat`    | Original Pedimap data file (pedigree + traits + markers + IBD) |
| `.pmp`    | Pedimap project file (references a `.dat`, adds subpopulation metadata) |
| `.json`   | Pedimap 2 native JSON format |

### Output
| Extension | Description |
|-----------|-------------|
| `.json`   | Full pedigree export (via `/api/export/json`) |
| `.dat`    | Pedimap-compatible export (via `/api/export/dat`) |

---

## 🗺 Roadmap

### Planned features
- [ ] IBD probability chromosome strip visualization
- [ ] BrAPI integration (pull pedigrees from BreedBase / GRIN)
- [ ] Multi-trait comparison view
- [ ] Export to SVG / PDF
- [ ] Automatic update delivery (Tauri updater)
- [ ] macOS notarization in CI

### Framework migration
- [ ] **Migrate to Tauri 2.x** — Tauri 2.0 was released in October 2024 and
      introduces a rewritten plugin system, improved security model, and full
      mobile support (iOS / Android). It also ships with wry 0.39+ and
      webkit2gtk 0.20+, which permanently resolves the Linux webkit2gtk
      compilation incompatibility present in Tauri 1.x. Migration is planned
      as the next major infrastructure update. See the official guide at
      https://tauri.app/blog/tauri-2-0-0-released/ for details.

---

## 📖 Citation

If you use Pedimap 2 in published research, please cite:

> Voorrips RE, Bink MCAM, Van de Weg WE (2012) Pedimap: software for the
> visualization of genetic and phenotypic data in pedigrees. *J. Hered.* 103:903–907.
> doi:10.1093/jhered/ess060

> Fresnedo-Lab (2025) Pedimap 2: modern multiplatform pedigree visualization for
> plant breeding. https://github.com/Fresnedo-Lab/pedimap2

---

## 📄 License

MIT — see [LICENSE](LICENSE).

---

## Acknowledgements

Pedimap 2 is a ground-up reimplementation inspired by the original Pedimap 1.x
by Roeland Voorrips, Marco Bink, and Eric van de Weg (Wageningen University &
Research). We gratefully acknowledge their foundational work and the Pedimap
community.
