#!/usr/bin/env bash
# scripts/test-release-assets.sh
# ==============================
# Offline test for scripts/release-assets.sh. It builds fake bundle folders
# with the file names Tauri's bundler really produces (the v2.1.0 release
# assets, with GitHub's "." turned back into the original space), runs the
# rename / latest.json / checksum / release-notes logic, and checks the result.
# It also checks that broken inputs fail instead of producing a release.
#
# Usage: scripts/test-release-assets.sh      (needs bash, jq, awk)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_ASSETS="$SCRIPT_DIR/release-assets.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

VERSION=2.1.0
passed=0 failed=0
pass() { echo "  ok    $*"; passed=$((passed + 1)); }
fail() { echo "  FAIL  $*"; failed=$((failed + 1)); }
check() { local desc=$1; shift; if "$@"; then pass "$desc"; else fail "$desc"; fi; }

sha256_check() {
  if command -v sha256sum >/dev/null; then sha256sum -c --quiet "$@"; else shasum -a 256 -c --quiet "$@"; fi
}

# make_bundles DIR VERSION → fake download-artifact layout for one release.
make_bundles() {
  local in=$1 v=$2 f
  local files="
bundle-x86_64-pc-windows-msvc/nsis/Pedimap 2_${v}_x64-setup.exe
bundle-x86_64-pc-windows-msvc/nsis/Pedimap 2_${v}_x64-setup.exe.sig
bundle-x86_64-pc-windows-msvc/msi/Pedimap 2_${v}_x64_en-US.msi
bundle-x86_64-pc-windows-msvc/msi/Pedimap 2_${v}_x64_en-US.msi.sig
bundle-aarch64-apple-darwin/dmg/Pedimap 2_${v}_aarch64.dmg
bundle-aarch64-apple-darwin/macos/Pedimap 2.app.tar.gz
bundle-aarch64-apple-darwin/macos/Pedimap 2.app.tar.gz.sig
bundle-x86_64-apple-darwin/dmg/Pedimap 2_${v}_x64.dmg
bundle-x86_64-apple-darwin/macos/Pedimap 2.app.tar.gz
bundle-x86_64-apple-darwin/macos/Pedimap 2.app.tar.gz.sig
bundle-x86_64-unknown-linux-gnu/appimage/Pedimap 2_${v}_amd64.AppImage
bundle-x86_64-unknown-linux-gnu/appimage/Pedimap 2_${v}_amd64.AppImage.sig
bundle-x86_64-unknown-linux-gnu/deb/Pedimap 2_${v}_amd64.deb
bundle-x86_64-unknown-linux-gnu/deb/Pedimap 2_${v}_amd64.deb.sig
bundle-x86_64-unknown-linux-gnu/rpm/Pedimap 2-${v}-1.x86_64.rpm
bundle-x86_64-unknown-linux-gnu/rpm/Pedimap 2-${v}-1.x86_64.rpm.sig
pedimap2-manual/pedimap2-manual.pdf
"
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    mkdir -p "$in/$(dirname "$f")"
    # Contents identify the source, so we can tell which file ended up where.
    # .sig files get a fake base64 signature (Tauri writes them without a newline).
    case "$f" in
      *.sig) printf 'c2lnbmF0dXJlIGZvciAlcw==:%s' "$f" > "$in/$f" ;;
      *)     printf 'payload:%s\n' "$f" > "$in/$f" ;;
    esac
  done <<EOF
$files
EOF
}

# run_case NAME VERSION INPUT → runs release-assets.sh, sets $out/$notes/$log/$status.
run_case() {
  out="$WORK/$1/out" notes="$WORK/$1/notes.md" log="$WORK/$1/log.txt"
  mkdir -p "$WORK/$1"
  set +e
  "$RELEASE_ASSETS" "$2" "$3" "$out" "$notes" >"$log" 2>&1
  status=$?
  set -e
}

# ── 1. Happy path, with a stale 2.0.0 installer mixed in ─────────────────────
echo "Happy path (v$VERSION, with a stale 2.0.0 installer in the input)"
in="$WORK/happy/in"
make_bundles "$in" "$VERSION"
printf 'stale\n' > "$in/bundle-x86_64-pc-windows-msvc/nsis/Pedimap 2_2.0.0_x64-setup.exe"
run_case happy "$VERSION" "$in"
check "exits 0" [ "$status" -eq 0 ]
[ "$status" -eq 0 ] || cat "$log"

expected="Pedimap2-$VERSION-Linux-x86_64.AppImage
Pedimap2-$VERSION-Linux-x86_64.deb
Pedimap2-$VERSION-Linux-x86_64.rpm
Pedimap2-$VERSION-User-Manual.pdf
Pedimap2-$VERSION-Windows-Installer.exe
Pedimap2-$VERSION-Windows.msi
Pedimap2-$VERSION-macOS-AppleSilicon-update.app.tar.gz
Pedimap2-$VERSION-macOS-AppleSilicon-update.app.tar.gz.sig
Pedimap2-$VERSION-macOS-AppleSilicon.dmg
Pedimap2-$VERSION-macOS-Intel-update.app.tar.gz
Pedimap2-$VERSION-macOS-Intel-update.app.tar.gz.sig
Pedimap2-$VERSION-macOS-Intel.dmg
SHA256SUMS.txt
latest.json"
actual=$(cd "$out" 2>/dev/null && find . -type f | sed 's|^\./||' | LC_ALL=C sort)
expected=$(printf '%s\n' "$expected" | LC_ALL=C sort)
check "publishes exactly the 14 expected files" [ "$actual" = "$expected" ]
[ "$actual" = "$expected" ] || diff <(echo "$expected") <(echo "$actual") || true

contains() { grep -qF -- "$2" "$1"; }
check "stale 2.0.0 installer was not picked up" \
  contains "$out/Pedimap2-$VERSION-Windows-Installer.exe" "Pedimap 2_${VERSION}_x64-setup.exe"
check "Apple Silicon update archive came from the aarch64 build" \
  contains "$out/Pedimap2-$VERSION-macOS-AppleSilicon-update.app.tar.gz" "bundle-aarch64-apple-darwin/"
check "Intel update archive came from the x86_64 build" \
  contains "$out/Pedimap2-$VERSION-macOS-Intel-update.app.tar.gz" "bundle-x86_64-apple-darwin/"
check "SHA256SUMS.txt verifies" bash -c "cd '$out' && $(declare -f sha256_check); sha256_check SHA256SUMS.txt"
check "SHA256SUMS.txt covers latest.json and all 13 other files" \
  [ "$(wc -l < "$out/SHA256SUMS.txt" | tr -d ' ')" -eq 13 ]

# latest.json: every platform key, URL and signature.
base="https://github.com/Fresnedo-Lab/pedimap2/releases/download/v$VERSION"
json="$out/latest.json"
check "latest.json version is $VERSION" [ "$(jq -r .version "$json")" = "$VERSION" ]
check "latest.json pub_date is RFC 3339" \
  bash -c "jq -r .pub_date '$json' | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z\$'"
check "latest.json has exactly the 9 platform keys" \
  [ "$(jq -r '.platforms | keys | join(",")' "$json")" = "darwin-aarch64,darwin-x86_64,linux-x86_64,linux-x86_64-appimage,linux-x86_64-deb,linux-x86_64-rpm,windows-x86_64,windows-x86_64-msi,windows-x86_64-nsis" ]
while read -r platform file sigsrc; do
  check "$platform url → $file" \
    [ "$(jq -r --arg p "$platform" '.platforms[$p].url' "$json")" = "$base/$file" ]
  check "$platform signature = contents of $sigsrc" \
    [ "$(jq -r --arg p "$platform" '.platforms[$p].signature' "$json")" = "$(cat "$in/$sigsrc")" ]
  check "$platform url target is published" [ -f "$out/$file" ]
done <<EOF
darwin-aarch64 Pedimap2-$VERSION-macOS-AppleSilicon-update.app.tar.gz bundle-aarch64-apple-darwin/macos/Pedimap 2.app.tar.gz.sig
darwin-x86_64 Pedimap2-$VERSION-macOS-Intel-update.app.tar.gz bundle-x86_64-apple-darwin/macos/Pedimap 2.app.tar.gz.sig
windows-x86_64 Pedimap2-$VERSION-Windows-Installer.exe bundle-x86_64-pc-windows-msvc/nsis/Pedimap 2_${VERSION}_x64-setup.exe.sig
windows-x86_64-nsis Pedimap2-$VERSION-Windows-Installer.exe bundle-x86_64-pc-windows-msvc/nsis/Pedimap 2_${VERSION}_x64-setup.exe.sig
windows-x86_64-msi Pedimap2-$VERSION-Windows.msi bundle-x86_64-pc-windows-msvc/msi/Pedimap 2_${VERSION}_x64_en-US.msi.sig
linux-x86_64 Pedimap2-$VERSION-Linux-x86_64.AppImage bundle-x86_64-unknown-linux-gnu/appimage/Pedimap 2_${VERSION}_amd64.AppImage.sig
linux-x86_64-appimage Pedimap2-$VERSION-Linux-x86_64.AppImage bundle-x86_64-unknown-linux-gnu/appimage/Pedimap 2_${VERSION}_amd64.AppImage.sig
linux-x86_64-deb Pedimap2-$VERSION-Linux-x86_64.deb bundle-x86_64-unknown-linux-gnu/deb/Pedimap 2_${VERSION}_amd64.deb.sig
linux-x86_64-rpm Pedimap2-$VERSION-Linux-x86_64.rpm bundle-x86_64-unknown-linux-gnu/rpm/Pedimap 2-${VERSION}-1.x86_64.rpm.sig
EOF

# Release notes: placeholders filled, links point at real files, changelog pulled in.
check "notes have no unreplaced placeholders" bash -c "! grep -q '{{' '$notes'"
check "notes include the CHANGELOG $VERSION section" contains "$notes" "Pedigree orientation toggle"
check "notes stop before the next CHANGELOG section" bash -c "! grep -q 'First release of Pedimap 2' '$notes'"
links=$(grep -o "$base/[^)]*" "$notes" | sed "s|$base/||" | sort -u)
check "notes link to 8 distinct downloads" [ "$(printf '%s\n' "$links" | grep -c .)" -eq 8 ]
for f in $links; do
  check "notes link target is published: $f" [ -f "$out/$f" ]
done

# ── 2. Optional .deb/.rpm signatures absent: release still succeeds ───────────
echo "Without .deb/.rpm signatures (optional updater keys)"
in="$WORK/nodebsig/in"; make_bundles "$in" "$VERSION"
rm "$in/bundle-x86_64-unknown-linux-gnu/deb/"*.sig "$in/bundle-x86_64-unknown-linux-gnu/rpm/"*.sig
run_case nodebsig "$VERSION" "$in"
check "exits 0" [ "$status" -eq 0 ]
check "warns about the missing optional keys" contains "$log" "no signature for optional key linux-x86_64-deb"
check "latest.json leaves out linux-x86_64-deb and -rpm" \
  [ "$(jq -r '.platforms | keys | join(",")' "$out/latest.json")" = "darwin-aarch64,darwin-x86_64,linux-x86_64,linux-x86_64-appimage,windows-x86_64,windows-x86_64-msi,windows-x86_64-nsis" ]

# ── 3. Failure cases: each must exit non-zero and say why ────────────────────
expect_failure() {  # NAME VERSION INPUT MESSAGE
  run_case "$1" "$2" "$3"
  check "$1: exits non-zero" [ "$status" -ne 0 ]
  check "$1: reports '$4'" contains "$log" "$4"
  check "$1: publishes nothing" bash -c "[ ! -d '$out' ] || [ -z \"\$(ls -A '$out')\" ]"
}

echo "Failure cases"
in="$WORK/missing/in"; make_bundles "$in" "$VERSION"
rm "$in/bundle-x86_64-unknown-linux-gnu/rpm/"*.rpm
expect_failure missing-rpm "$VERSION" "$in" "*-$VERSION-1.x86_64.rpm"

in="$WORK/noartifact/in"; make_bundles "$in" "$VERSION"
rm -r "$in/bundle-x86_64-apple-darwin"
expect_failure missing-intel-build "$VERSION" "$in" "artifact 'bundle-x86_64-apple-darwin' is missing"

in="$WORK/mismatch/in"; make_bundles "$in" 2.0.0
expect_failure version-mismatch "$VERSION" "$in" "found 0"

in="$WORK/dup/in"; make_bundles "$in" "$VERSION"
cp "$in/bundle-aarch64-apple-darwin/macos/Pedimap 2.app.tar.gz" "$in/bundle-aarch64-apple-darwin/dmg/Old.app.tar.gz"
expect_failure duplicate-match "$VERSION" "$in" "found 2"

in="$WORK/nosig/in"; make_bundles "$in" "$VERSION"
rm "$in/bundle-x86_64-pc-windows-msvc/nsis/"*.sig
expect_failure missing-signature "$VERSION" "$in" "*_${VERSION}_x64-setup.exe.sig"

in="$WORK/nomsisig/in"; make_bundles "$in" "$VERSION"
rm "$in/bundle-x86_64-pc-windows-msvc/msi/"*.sig
expect_failure missing-msi-signature "$VERSION" "$in" "*_${VERSION}_x64_en-US.msi.sig"

in="$WORK/nochangelog/in"; make_bundles "$in" 9.9.9
expect_failure no-changelog-section 9.9.9 "$in" "no '## [9.9.9]' section"

in="$WORK/badversion/in"; make_bundles "$in" "$VERSION"
expect_failure bad-version "v$VERSION" "$in" "no leading v"

echo
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
