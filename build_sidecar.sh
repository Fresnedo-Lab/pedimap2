#!/usr/bin/env bash
# build_sidecar.sh
# =================
# Build the Python FastAPI sidecar with PyInstaller and copy it into
# src-tauri/binaries/ with the correct Tauri target-triple suffix.
#
# Run from the repository root BEFORE `cargo tauri build`.
#
# Usage:
#   chmod +x build_sidecar.sh && ./build_sidecar.sh
#
# Requirements:
#   Python ≥ 3.10 with pyinstaller and all backend deps installed.
#   (pip install -r backend/requirements.txt pyinstaller)

set -euo pipefail

# ── Detect Rust target triple ─────────────────────────────────────────────────
TRIPLE=$(rustc -vV 2>/dev/null | awk '/^host:/{print $2}')
if [[ -z "$TRIPLE" ]]; then
  echo "❌  rustc not found. Please install Rust: https://rustup.rs"
  exit 1
fi
echo "▶  Detected target triple: $TRIPLE"

# ── Ensure output dir ─────────────────────────────────────────────────────────
mkdir -p src-tauri/binaries

# ── Install Python deps ───────────────────────────────────────────────────────
echo "▶  Installing Python dependencies..."
pip install -r backend/requirements.txt pyinstaller --quiet

# ── Run PyInstaller ───────────────────────────────────────────────────────────
echo "▶  Running PyInstaller..."
cd backend
pyinstaller pedimap_backend.spec --distpath dist --workpath build --noconfirm --clean
cd ..

# ── Locate binary ─────────────────────────────────────────────────────────────
SRC="backend/dist/pedimap-backend"
if [[ ! -f "$SRC" ]]; then
  echo "❌  PyInstaller output not found at: $SRC"
  exit 1
fi

# ── Copy with triple suffix ───────────────────────────────────────────────────
DEST="src-tauri/binaries/pedimap-backend-${TRIPLE}"
cp "$SRC" "$DEST"
chmod +x "$DEST"

echo "✅  Sidecar binary placed at: $DEST"
echo ""
echo "Next: cargo tauri build"
