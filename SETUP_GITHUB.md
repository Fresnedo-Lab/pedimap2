# Setting up the Fresnedo-Lab/pedimap2 GitHub Repository

This guide walks you through creating the repository under your organisation
and making the first push so that automated releases start working immediately.

---

## Step 1 — Create the repository on GitHub

1. Go to https://github.com/organizations/Fresnedo-Lab/repositories/new
2. Fill in:
   - **Repository name:** `pedimap2`
   - **Description:** `Modern multiplatform pedigree visualisation for plant breeding — Tauri + React + FastAPI`
   - **Visibility:** Public *(recommended — enables free GitHub Actions minutes)*
   - **License:** MIT *(pre-selected from the drop-down)*
   - Do **NOT** initialise with a README, .gitignore or any files — the repo must be empty
3. Click **Create repository**

---

## Step 2 — Push the local source

```bash
# From the root of the extracted zip:
cd pedimap2-release

git init
git add .
git commit -m "feat: initial Pedimap 2 source — Tauri + FastAPI + React"
git branch -M main
git remote add origin https://github.com/Fresnedo-Lab/pedimap2.git
git push -u origin main
```

---

## Step 3 — Configure branch protection (recommended)

1. Go to **Settings → Branches → Add rule**
2. Branch name pattern: `main`
3. Enable:
   - ✅ Require a pull request before merging
   - ✅ Require status checks to pass before merging
     - Select: `Python backend tests`, `React frontend build`, `Tauri Rust compile check`
   - ✅ Require branches to be up to date before merging
4. Save changes

---

## Step 4 — Add repository topics

Go to the repository home page, click the ⚙ gear next to **About**, and add:
```
plant-breeding  pedigree  bioinformatics  tauri  fastapi  react  rust  python
genetics  genomics  visualization
```

---

## Step 5 — Create the first release

```bash
# Make sure you are on main with all changes committed, then:
git tag v2.0.0
git push origin v2.0.0
```

This triggers the `release.yml` workflow which will:
1. Build the Python sidecar with PyInstaller on each platform
2. Compile the React frontend
3. Build the Tauri native installer for Windows, macOS (arm64 + x64), and Linux
4. Create a **draft** GitHub Release with all installers attached

Go to **Releases** on GitHub, review the draft, and click **Publish release**
when you are satisfied.

---

## Step 6 — Optional — Code signing (unsigned builds work fine without this)

### macOS
Set these secrets in **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|--------|-------|
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` certificate |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12` |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | Your Apple ID e-mail |
| `APPLE_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | 10-character team ID |

### Windows
| Secret | Value |
|--------|-------|
| `WINDOWS_CERTIFICATE` | Base64-encoded `.pfx` certificate |
| `WINDOWS_CERTIFICATE_PASSWORD` | Password for the `.pfx` |

---

## CI badge status

After the first push, the CI badge in `README.md` will show live status.
The URL is already correct:
```
https://github.com/Fresnedo-Lab/pedimap2/actions/workflows/ci.yml
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `error: sidecar not found` | Make sure `build_sidecar.sh` ran successfully before `cargo tauri build` |
| `WebKit2GTK not found` (Linux CI) | The `ci.yml` installs it automatically; for local builds: `sudo apt install libwebkit2gtk-4.0-dev` |
| macOS `Unidentified developer` | Right-click the `.app` → Open (first launch only, for unsigned builds) |
| Windows SmartScreen warning | Click "More info" → "Run anyway" (for unsigned builds) |
| GitHub Actions fails on `cargo check` | Check that the stub sidecar binary is being created in the CI step |
