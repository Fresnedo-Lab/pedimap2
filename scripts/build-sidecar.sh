#!/usr/bin/env bash
#
# build-sidecar.sh
# ================
# Builds the Python backend into a standalone binary with PyInstaller and
# stages it under src-tauri/binaries/ using the name Tauri's sidecar
# resolution expects: pedimap-backend-${RUST_TARGET_TRIPLE}[.exe].
#
# Run from anywhere; paths are resolved relative to the repo root.

set -euo pipefail

# ── Resolve repo root (this script lives in <root>/scripts) ──────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

# ── Backend virtual environment ──────────────────────────────────────────────
# Build MUST use the backend venv, not whatever python3 is on PATH. Xcode's
# system Python 3.9 has none of our deps, and PyInstaller happily produces a
# tiny, broken binary with every hidden import missing when run against it.
VENV_PY="backend/.venv/bin/python"

# ── Derive the Rust host target triple dynamically ───────────────────────────
TRIPLE="$(rustc -vV | sed -n 's|host: ||p')"
if [ -z "${TRIPLE}" ]; then
  echo "ERROR: could not determine Rust target triple (is 'rustc' on PATH?)" >&2
  exit 1
fi

# ── Preflight: the backend venv must exist ───────────────────────────────────
if [ ! -f "${VENV_PY}" ]; then
  echo "Backend venv not found. Create it with:" >&2
  echo "   python3.12 -m venv backend/.venv" >&2
  echo "   source backend/.venv/bin/activate" >&2
  echo "   pip install -r backend/requirements.txt pyinstaller" >&2
  exit 1
fi

# ── Preflight: the venv must actually have our runtime dependencies ───────────
if ! "${VENV_PY}" -c "import fastapi, uvicorn, networkx" >/dev/null 2>&1; then
  echo "ERROR: backend venv is missing required dependencies." >&2
  echo "       'import fastapi, uvicorn, networkx' failed in ${VENV_PY}." >&2
  echo "       Install them with:" >&2
  echo "         source backend/.venv/bin/activate" >&2
  echo "         pip install -r backend/requirements.txt pyinstaller" >&2
  exit 1
fi

# ── Preflight: PyInstaller must be installed inside the venv ──────────────────
if ! "${VENV_PY}" -m PyInstaller --version >/dev/null 2>&1; then
  echo "ERROR: PyInstaller not found in the backend venv." >&2
  echo "       Install it with: ${VENV_PY} -m pip install pyinstaller" >&2
  exit 1
fi

# ── Platform-specific binary suffix ──────────────────────────────────────────
EXE_SUFFIX=""
case "${TRIPLE}" in
  *windows*) EXE_SUFFIX=".exe" ;;
esac

SRC_BIN="backend/dist/pedimap-backend${EXE_SUFFIX}"
DEST_DIR="src-tauri/binaries"
DEST_BIN="${DEST_DIR}/pedimap-backend-${TRIPLE}${EXE_SUFFIX}"

# ── Build with PyInstaller ───────────────────────────────────────────────────
echo "==> Building sidecar with PyInstaller (target: ${TRIPLE})"
echo "==> Using interpreter: ${ROOT_DIR}/${VENV_PY}"
(
  cd backend
  "${ROOT_DIR}/${VENV_PY}" -m PyInstaller pedimap_backend.spec --distpath dist --noconfirm
)

# ── Verify PyInstaller produced the expected output ──────────────────────────
if [ ! -f "${SRC_BIN}" ]; then
  echo "ERROR: PyInstaller did not produce the expected binary:" >&2
  echo "       ${ROOT_DIR}/${SRC_BIN}" >&2
  echo "       Check backend/pedimap_backend.spec and the PyInstaller output above." >&2
  exit 1
fi

# ── Stage the binary where Tauri expects it ──────────────────────────────────
mkdir -p "${DEST_DIR}"
cp "${SRC_BIN}" "${DEST_BIN}"

# ── Make it executable on Unix (no-op / not needed for Windows .exe) ─────────
if [ -z "${EXE_SUFFIX}" ]; then
  chmod +x "${DEST_BIN}"
fi

# ── Sanity check the bundle size ─────────────────────────────────────────────
# A correctly bundled sidecar is tens of MB. A few-MB binary means PyInstaller
# ran against an interpreter without our deps and dropped every hidden import.
SIZE_BYTES="$(wc -c < "${DEST_BIN}" | tr -d '[:space:]')"
SIZE_MB=$(( SIZE_BYTES / 1024 / 1024 ))
MIN_BYTES=$(( 10 * 1024 * 1024 ))

echo "==> Sidecar staged at: ${ROOT_DIR}/${DEST_BIN}"
echo "==> Staged binary size: ${SIZE_MB} MB (${SIZE_BYTES} bytes)"

if [ "${SIZE_BYTES}" -lt "${MIN_BYTES}" ]; then
  echo "" >&2
  echo "WARNING: staged binary is only ${SIZE_MB} MB (< 10 MB) — the bundle looks incomplete." >&2
  echo "WARNING: PyInstaller hidden imports may have failed. Confirm the build used the" >&2
  echo "WARNING: backend venv (${VENV_PY}) and not a system python3 missing our deps." >&2
fi
