#!/usr/bin/env bash
# scripts/smoke-test-backend.sh
# =============================
# Starts a BUILT pedimap-backend (as shipped inside the app or package), waits
# for /api/health, checks the version it reports, and stops it with SIGTERM.
#
# Usage: scripts/smoke-test-backend.sh <backend-binary> <expected-version> [timeout-seconds]
#   SMOKE_ARCH=x86_64  run it via `arch -x86_64` (Rosetta on an Apple Silicon Mac)
#
# Why: the 2.1.0 and 2.1.1 Mac builds passed every file-level check (names,
# checksums, architectures) yet their backend could not start once signed:
# macOS refused to load the Python library PyInstaller unpacks at startup.
# Only running the signed binary shows that. Used by the build jobs in
# .github/workflows/release.yml and by scripts/verify-macos-dmg.sh --run.
# Unix only; the Windows job does the same in PowerShell.

set -euo pipefail

[ $# -ge 2 ] || { echo "usage: $0 <backend-binary> <expected-version> [timeout-seconds]" >&2; exit 2; }
bin=$1 expected=$2 timeout=${3:-30}
url=http://127.0.0.1:8765/api/health

err() {
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::error::$*" >&2; else echo "FAIL: $*" >&2; fi
}

[ -x "$bin" ] || { err "backend not found or not executable: $bin"; exit 1; }
if curl -sf -m 2 "$url" >/dev/null 2>&1; then
  err "something is already answering on port 8765; stop it first"
  exit 1
fi

log=$(mktemp)
if [ -n "${SMOKE_ARCH:-}" ]; then
  arch "-$SMOKE_ARCH" "$bin" >"$log" 2>&1 &
else
  "$bin" >"$log" 2>&1 &
fi
pid=$!

show_log() {
  echo "----- backend output (stdout + stderr) -----" >&2
  tail -n 60 "$log" >&2
  echo "--------------------------------------------" >&2
}

# SIGTERM is what the app sends on quit; the PyInstaller bootloader forwards it
# to the Python child. Escalate only if it is ignored.
stop_backend() {
  kill -TERM "$pid" 2>/dev/null || return 0
  for _ in $(seq 1 20); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.25
  done
  echo "warning: backend ignored SIGTERM for 5 s; killing it" >&2
  pkill -KILL -P "$pid" 2>/dev/null || true
  kill -KILL "$pid" 2>/dev/null || true
  return 1
}

echo "Starting $(basename "$bin")${SMOKE_ARCH:+ under arch -$SMOKE_ARCH} (expecting version $expected, timeout ${timeout}s)"
body=""
deadline=$((SECONDS + timeout))
while [ $SECONDS -lt $deadline ]; do
  if body=$(curl -sf -m 2 "$url" 2>/dev/null); then break; fi
  body=""
  if ! kill -0 "$pid" 2>/dev/null; then
    wait "$pid" 2>/dev/null && code=0 || code=$?
    err "backend exited during startup (exit status $code) without answering $url"
    show_log; rm -f "$log"; exit 1
  fi
  sleep 0.5
done

if [ -z "$body" ]; then
  err "backend did not answer $url within ${timeout}s"
  stop_backend || true; show_log; rm -f "$log"; exit 1
fi

echo "health: $body"
version=$(printf '%s' "$body" | sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p')
if [ "$version" != "$expected" ]; then
  err "backend reports version '$version', expected '$expected'"
  stop_backend || true; show_log; rm -f "$log"; exit 1
fi

if ! stop_backend; then
  err "backend did not stop on SIGTERM (it would be left running after the app quits)"
  show_log; rm -f "$log"; exit 1
fi
sleep 0.5
if curl -sf -m 2 "$url" >/dev/null 2>&1; then
  err "port 8765 still answers after SIGTERM: a backend process was left running"
  rm -f "$log"; exit 1
fi
rm -f "$log"
echo "PASS: backend $version started, answered /api/health, and stopped on SIGTERM"
