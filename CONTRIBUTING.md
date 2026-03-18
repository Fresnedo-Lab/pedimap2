# Contributing to Pedimap 2

Thank you for your interest in contributing! Pedimap 2 is an open-source project
maintained by [Fresnedo-Lab](https://github.com/Fresnedo-Lab).

---

## Development setup

### Prerequisites

| Tool       | Version   | Install |
|------------|-----------|---------|
| Python     | ≥ 3.10    | [python.org](https://www.python.org) |
| Node.js    | ≥ 18      | [nodejs.org](https://nodejs.org) |
| Rust       | stable    | `curl https://sh.rustup.rs -sSf | sh` |
| Tauri CLI  | ≥ 1.6     | `cargo install tauri-cli` |

### 1 — Clone the repository

```bash
git clone https://github.com/Fresnedo-Lab/pedimap2.git
cd pedimap2
```

### 2 — Install backend dependencies

```bash
pip install -r backend/requirements.txt
```

### 3 — Install frontend dependencies

```bash
cd frontend && npm install && cd ..
```

### 4 — Run in development mode

**Terminal 1 — Python backend:**
```bash
cd backend && python api.py
```

**Terminal 2 — Tauri dev window (hot-reload):**
```bash
cargo tauri dev
```

---

## Project structure

```
pedimap2/
├── backend/                  Python FastAPI backend
│   ├── api.py                REST API (14 endpoints)
│   ├── pedigree_engine.py    Core engine — NetworkX DAG
│   ├── pmp_parser.py         .dat / .pmp format parser
│   ├── sample_data.py        Demo apple breeding dataset
│   ├── requirements.txt      Python dependencies
│   └── pedimap_backend.spec  PyInstaller bundle spec
│
├── frontend/                 React 18 + TypeScript frontend
│   ├── src/
│   │   ├── App.tsx           Root component
│   │   ├── components/       PedigreeCanvas, IndividualPanel
│   │   └── hooks/useApi.ts   Type-safe API client
│   ├── package.json
│   └── vite.config.ts
│
├── src-tauri/                Rust + Tauri shell
│   ├── src/main.rs           Sidecar launcher + commands
│   ├── Cargo.toml
│   ├── tauri.conf.json       Bundle config (MSI/DMG/AppImage)
│   └── icons/                App icons (all sizes)
│
├── .github/workflows/
│   ├── release.yml           Cross-platform release CI
│   └── ci.yml                PR validation CI
│
├── build_sidecar.sh          Build Python sidecar (Linux/macOS)
├── build_sidecar.ps1         Build Python sidecar (Windows)
└── README.md
```

---

## Branching model

| Branch    | Purpose |
|-----------|---------|
| `main`    | Stable releases only — protected, requires PR |
| `develop` | Integration branch for features |
| `feat/*`  | Feature branches (merge into `develop`) |
| `fix/*`   | Bug-fix branches |

---

## Submitting a pull request

1. Fork the repository and create a branch from `develop`.
2. Make your changes with clear, focused commits.
3. Add or update tests for any backend logic changes.
4. Open a PR against `develop` with a clear description.

---

## Releasing a new version

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.
2. Commit: `git commit -m "chore: bump version to vX.Y.Z"`
3. Tag: `git tag vX.Y.Z && git push origin vX.Y.Z`
4. The `release.yml` workflow will automatically build installers for all
   platforms and create a GitHub Release draft.

---

## Citation

If you use Pedimap 2 in published research, please cite both the original paper
and this repository:

> Voorrips RE, Bink MCAM, Van de Weg WE (2012) Pedimap: software for the
> visualization of genetic and phenotypic data in pedigrees. *J. Hered.* 103:903–907.
> doi:10.1093/jhered/ess060

> Fresnedo-Lab (2025) Pedimap 2: multiplatform pedigree visualisation.
> https://github.com/Fresnedo-Lab/pedimap2
