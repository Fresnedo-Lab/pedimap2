# CLAUDE.md — Pedimap 2

## Project overview
Pedimap 2 is a multiplatform desktop application for pedigree visualization
in plant breeding. Spiritual successor to Pedimap 1.x (Voorrips et al. 2012,
J. Hered. 103:903–907).

Stack: Tauri 2.x (Rust shell) · React 18 / TypeScript / Vite (frontend)
· FastAPI / NetworkX / PyInstaller (Python backend sidecar)

Repo: github.com/Fresnedo-Lab/pedimap2

## Directory layout
backend/          FastAPI app + PyInstaller spec + tests
frontend/         React 18 / TypeScript / Vite
src-tauri/        Rust / Tauri shell (main.rs, Cargo.toml, tauri.conf.json,
                  capabilities/, icons/)
docs/             User manual source (Markdown)
.github/workflows/  ci.yml and release.yml

## Key conventions
- American English throughout
- Backend sidecar runs on 127.0.0.1:8765
- Sidecar binary naming: pedimap-backend-{rust-triple} in src-tauri/binaries/
- Semver: bump package.json, Cargo.toml, and tauri.conf.json together
- All backend routes prefixed /api/

## Build commands
Dev:   cd backend && uvicorn api:app --port 8765   (terminal A)
       cargo tauri dev                              (terminal B)
Prod:  cd backend && pyinstaller pedimap_backend.spec --distpath dist --noconfirm
       cargo tauri build --target aarch64-apple-darwin

## Test commands
Backend:  cd backend && python -m pytest tests/ -v
Frontend: cd frontend && npm run typecheck && npm run build
Rust:     cd src-tauri && cargo check

## Tauri 2.x migration checklist
- [ ] cargo tauri migrate
- [ ] Cargo.toml: tauri = "2", remove window-all feature
- [ ] tauri.conf.json: remove allowlist, add capabilities/
- [ ] main.rs: rewrite for Tauri 2 Builder API
- [ ] ci.yml: libwebkit2gtk-4.1-dev, Node 22
- [ ] release.yml: tauri-apps/tauri-action v0 + Tauri 2, Linux re-enabled
- [ ] Verify Linux AppImage + deb build in CI

## GitHub secrets in place
APPLE_CERTIFICATE, APPLE_CERTIFICATE_PASSWORD, APPLE_SIGNING_IDENTITY,
APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID

## Known issues
- Tauri 1.x had a Linux webkit2gtk ABI mismatch — Tauri 2 resolves this
- secrets context not available in step-level if: — use job-level env: blocks
