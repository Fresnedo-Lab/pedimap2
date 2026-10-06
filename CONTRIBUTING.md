# Contributing to Pedimap 2

Thank you for your interest in contributing! Pedimap 2 is an open-source project
maintained by [Fresnedo-Lab](https://github.com/Fresnedo-Lab).

---

## Development setup

### Prerequisites

| Tool       | Version   | Install |
|------------|-----------|---------|
| Python     | 3.12      | [python.org](https://www.python.org) |
| Node.js    | 22        | [nodejs.org](https://nodejs.org) |
| Rust       | stable    | `curl https://sh.rustup.rs -sSf \| sh` |
| Tauri CLI  | ^2        | `cargo install tauri-cli --version "^2" --locked` |

### 1 — Clone the repository

```bash
git clone https://github.com/Fresnedo-Lab/pedimap2.git
cd pedimap2
```

### 2 — Install backend dependencies

An isolated virtual environment is required. `npm run app:dev` builds the
Python sidecar with PyInstaller, which bundles whichever interpreter it runs
under — so the dependencies (and PyInstaller) must live in `backend/.venv`.
`scripts/build-sidecar.sh` refuses to run without it.

```bash
python3.12 -m venv backend/.venv
source backend/.venv/bin/activate          # Windows: backend\.venv\Scripts\activate
pip install -r backend/requirements.txt pyinstaller
```

### 3 — Install frontend dependencies

```bash
cd frontend && npm install && cd ..
```

### 4 — Run in development mode

```bash
npm run app:dev
```

This builds and stages the Python sidecar, then launches the Tauri dev window
with hot-reload. The backend runs as a sidecar on `127.0.0.1:8765`; the
frontend polls `/api/health` and waits for it before issuing other requests.

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
│   ├── pedimap_backend.spec  PyInstaller bundle spec
│   └── tests/                Unit tests (pytest)
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
├── .github/
│   ├── workflows/
│   │   ├── release.yml       Cross-platform release (draft + dry run)
│   │   ├── docs.yml          User manual PDF
│   │   └── ci.yml            PR validation CI
│   └── release-notes-template.md
│
├── scripts/
│   ├── build-sidecar.sh      Build + stage the Python sidecar
│   ├── release-assets.sh     Release file names, latest.json, checksums
│   └── test-release-assets.sh  Offline test for release-assets.sh
├── CHANGELOG.md              Release history (feeds the release notes)
├── package.json              Root scripts (sidecar, app:dev, app:build)
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

## Writing tests

Backend tests live in `backend/tests/` and run with pytest. Add a new file
`test_<feature>.py` for each area you are testing. Keep tests focused and
independent — each test function should set up its own data rather than
relying on global state.

```bash
# Run all backend tests locally
pip install pytest
python -m pytest backend/tests/ -v --tb=short
```

---

## Releasing a new version

`.github/workflows/release.yml` builds all four targets, renames the
installers (for example `Pedimap2-2.1.1-macOS-AppleSilicon.dmg`), and creates
a **draft** release. It never adds files to an existing release, and it stops
if the tag and the version files disagree.

1. **Bump the version** in all four files — they must match:
   `package.json`, `frontend/package.json`, `src-tauri/Cargo.toml`,
   `src-tauri/tauri.conf.json`. (The backend reads its version from the root
   `package.json`, so `/api/health` follows automatically.)
2. **Update `CHANGELOG.md`**: rename `## [Unreleased]` to `## [X.Y.Z] — YYYY-MM-DD`
   (or add that section) and update the link references at the bottom. The
   release notes' "What's new" is copied from this section; the workflow
   fails if it is missing.
3. Commit (`git commit -m "chore: bump version to vX.Y.Z"`) and merge to `main`.
4. **Dry run.** In GitHub, open **Actions → Release → Run workflow**, pick
   `main`, and leave **dry_run** checked. When it finishes, download the
   `release-preview-vX.Y.Z` artifact and check the file names,
   `release-notes.md`, and `latest.json`. Nothing is published.
5. **Tag and push:** `git tag -a vX.Y.Z -m "Pedimap 2 X.Y.Z" && git push origin vX.Y.Z`
6. When the run finishes, open the **draft** on the Releases page, review it,
   and click **Publish release**. Publishing also makes it the update that
   installed copies of Pedimap 2 are offered.

**If a release for the tag already exists**, the workflow stops instead of
adding to it. Delete the release (`gh release delete vX.Y.Z --yes`, which
keeps the tag), then re-run the workflow from the Actions tab.

**Changing file names** means editing the rename table at the top of
`scripts/release-assets.sh`, the links in `.github/release-notes-template.md`,
and the table in `README.md`. Then run `scripts/test-release-assets.sh`.

---

## Spelling convention

All documentation and code comments in this repository use **American English**
(e.g. *visualization*, *coloring*, *notarized*, *artifact*).

---

## Citation

If you use Pedimap 2 in published research, please cite both the original paper
and this repository:

> Voorrips RE, Bink MCAM, Van de Weg WE (2012) Pedimap: software for the
> visualization of genetic and phenotypic data in pedigrees. *J. Hered.* 103:903–907.
> doi:10.1093/jhered/ess060

> Fresnedo-Lab (2025) Pedimap 2: multiplatform pedigree visualization.
> https://github.com/Fresnedo-Lab/pedimap2
