#!/usr/bin/env bash
# scripts/verify-macos-dmg.sh
# ===========================
# Checks that every executable inside a Pedimap 2 DMG is built for the Mac it
# is meant for. The 2.1.0 Intel DMG shipped an x86_64 app with an arm64
# pedimap-backend: the app opened, but its backend could never start on an
# Intel Mac. Nothing in the build failed, so check the finished DMG.
#
# Usage: scripts/verify-macos-dmg.sh <dmg-path> <x86_64|arm64>
#   e.g. scripts/verify-macos-dmg.sh Pedimap2-2.1.1-macOS-Intel.dmg x86_64
#        scripts/verify-macos-dmg.sh Pedimap2-2.1.1-macOS-AppleSilicon.dmg arm64
#
# Mounts the DMG read-only without opening a Finder window, inspects every
# Mach-O file in *.app/Contents/MacOS/, prints one PASS/FAIL line per binary,
# and always detaches. A universal binary passes if it contains the expected
# architecture, since it runs there. Exit status: 0 all pass, 1 any fail,
# 2 usage or mount error. macOS only (hdiutil, lipo).

set -euo pipefail

usage() {
  echo "usage: $0 <dmg-path> <x86_64|arm64>" >&2
  exit 2
}

[ $# -eq 2 ] || usage
dmg=$1 expected=$2
case "$expected" in x86_64|arm64) ;; *) usage ;; esac
[ -f "$dmg" ] || { echo "error: no such file: $dmg" >&2; exit 2; }

mountpoint=$(mktemp -d "${TMPDIR:-/tmp}/pedimap-dmg.XXXXXX")
mounted=false
cleanup() {
  if $mounted; then
    hdiutil detach "$mountpoint" -quiet 2>/dev/null ||
      hdiutil detach "$mountpoint" -force -quiet 2>/dev/null ||
      echo "warning: could not detach $mountpoint" >&2
  fi
  rmdir "$mountpoint" 2>/dev/null || true
}
trap cleanup EXIT

if ! hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$mountpoint" "$dmg" -quiet; then
  echo "error: could not mount $dmg" >&2
  exit 2
fi
mounted=true

apps=()
for app in "$mountpoint"/*.app; do
  [ -d "$app" ] && apps+=("$app")
done
if [ ${#apps[@]} -eq 0 ]; then
  echo "error: no .app bundle found in $dmg" >&2
  exit 2
fi

echo "Checking $(basename "$dmg") for $expected"
checked=0
failed=()
for app in "${apps[@]}"; do
  while IFS= read -r -d '' bin; do
    info=$(file -b "$bin")
    case "$info" in *Mach-O*) ;; *) continue ;; esac
    checked=$((checked + 1))
    archs=$(lipo -archs "$bin" 2>/dev/null || echo "unknown")
    name="$(basename "$app")/Contents/MacOS/${bin#"$app/Contents/MacOS/"}"
    case " $archs " in
      *" $expected "*) printf 'PASS  %-50s %s\n' "$name" "$archs" ;;
      *)               printf 'FAIL  %-50s %s (expected %s)\n' "$name" "$archs" "$expected"
                       failed+=("$name ($archs)") ;;
    esac
  done < <(find "$app/Contents/MacOS" -type f -print0 | sort -z)
done

if [ "$checked" -eq 0 ]; then
  echo "error: no Mach-O binaries found in Contents/MacOS" >&2
  exit 2
fi

if [ ${#failed[@]} -gt 0 ]; then
  echo "FAIL: ${#failed[@]} of $checked binaries are not built for $expected:" >&2
  printf '  - %s\n' "${failed[@]}" >&2
  echo "This DMG must not be published: it will not work on $expected Macs." >&2
  exit 1
fi
echo "OK: all $checked binaries are built for $expected."
