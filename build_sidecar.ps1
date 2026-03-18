# build_sidecar.ps1
# ==================
# Build the Python FastAPI sidecar with PyInstaller and copy it into
# src-tauri\binaries\ with the correct Tauri target-triple suffix.
#
# Run from the repository root BEFORE `cargo tauri build`.
#
# Usage (PowerShell):
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\build_sidecar.ps1
#
# Requirements:
#   Python >= 3.10 in PATH, pip, rustc (from rustup).

$ErrorActionPreference = "Stop"

# ── Detect Rust target triple ─────────────────────────────────────────────────
$rustcOutput = rustc -vV 2>&1
$triple = ($rustcOutput | Select-String "^host:").ToString().Split(":")[1].Trim()
if (-not $triple) {
    Write-Error "rustc not found. Please install Rust: https://rustup.rs"
    exit 1
}
Write-Host "▶  Target triple: $triple" -ForegroundColor Cyan

# ── Ensure output dir ─────────────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path "src-tauri\binaries" | Out-Null

# ── Install Python deps ───────────────────────────────────────────────────────
Write-Host "▶  Installing Python dependencies..." -ForegroundColor Cyan
pip install -r backend\requirements.txt pyinstaller -q

# ── Run PyInstaller ───────────────────────────────────────────────────────────
Write-Host "▶  Running PyInstaller..." -ForegroundColor Cyan
Push-Location backend
pyinstaller pedimap_backend.spec --distpath dist --workpath build --noconfirm --clean
Pop-Location

# ── Locate binary ─────────────────────────────────────────────────────────────
$src = "backend\dist\pedimap-backend.exe"
if (-not (Test-Path $src)) {
    Write-Error "PyInstaller output not found at: $src"
    exit 1
}

# ── Copy with triple suffix ───────────────────────────────────────────────────
$dest = "src-tauri\binaries\pedimap-backend-${triple}.exe"
Copy-Item $src $dest -Force

Write-Host "✅  Sidecar placed at: $dest" -ForegroundColor Green
Write-Host ""
Write-Host "Next: cargo tauri build" -ForegroundColor Yellow
