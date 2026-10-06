#!/usr/bin/env bash
# scripts/release-assets.sh
# =========================
# Turns raw Tauri bundler output into exactly the files a Pedimap 2 release
# publishes: descriptive names, the updater manifest latest.json, and
# SHA256SUMS.txt. It also renders the release notes. Called by the publish job
# in .github/workflows/release.yml; scripts/test-release-assets.sh runs it
# offline against fake bundles.
#
# Usage: scripts/release-assets.sh VERSION INPUT_DIR OUTPUT_DIR NOTES_FILE
#   VERSION     e.g. 2.1.1 (no leading "v")
#   INPUT_DIR   one subfolder per workflow artifact, as actions/download-artifact
#               lays them out: INPUT_DIR/bundle-aarch64-apple-darwin/dmg/…
#   OUTPUT_DIR  created empty; receives every file to upload, nothing else
#   NOTES_FILE  rendered release body (not uploaded as an asset)
#
# Why an explicit table instead of "upload whatever the bundler produced":
# tauri-action used to upload every bundle into whatever release matched the
# tag and never removed old files, so one release ended up mixing installers
# from two versions under cryptic names. Here each published file is listed
# once, must match exactly one input file, and has the version in its name.
# Anything not in the table is ignored.
#
# Must stay compatible with macOS's bash 3.2 so the test runs locally.

set -euo pipefail

REPO_URL="https://github.com/Fresnedo-Lab/pedimap2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
CHANGELOG="${CHANGELOG:-$REPO_ROOT/CHANGELOG.md}"
NOTES_TEMPLATE="${NOTES_TEMPLATE:-$REPO_ROOT/.github/release-notes-template.md}"

# ── Rename table ─────────────────────────────────────────────────────────────
# One row per published file. Columns (whitespace-separated, no spaces inside):
#   artifact   workflow artifact (folder) the file comes from
#   raw glob   bundler file name; {V} is replaced by the version, so a stale
#              bundle from another version can never match
#   published  final name is Pedimap2-VERSION-<this>
# The bundler writes "Pedimap 2_2.1.0_x64.dmg" (with a space); GitHub shows the
# space as a dot, which is where names like "Pedimap.2_2.1.0_x64.dmg" came from.
# The macOS updater archive is "Pedimap 2.app.tar.gz" for BOTH architectures
# (no version, no arch), so the artifact column is what tells them apart.
#
# artifact                         raw glob                  published
ASSETS='
bundle-x86_64-pc-windows-msvc      *_{V}_x64-setup.exe       Windows-Installer.exe
bundle-x86_64-pc-windows-msvc      *_{V}_x64_en-US.msi       Windows.msi
bundle-aarch64-apple-darwin        *_{V}_aarch64.dmg         macOS-AppleSilicon.dmg
bundle-x86_64-apple-darwin         *_{V}_x64.dmg             macOS-Intel.dmg
bundle-x86_64-unknown-linux-gnu    *_{V}_amd64.AppImage      Linux-x86_64.AppImage
bundle-x86_64-unknown-linux-gnu    *_{V}_amd64.deb           Linux-x86_64.deb
bundle-x86_64-unknown-linux-gnu    *-{V}-1.x86_64.rpm        Linux-x86_64.rpm
bundle-aarch64-apple-darwin        *.app.tar.gz              macOS-AppleSilicon-update.app.tar.gz
bundle-aarch64-apple-darwin        *.app.tar.gz.sig          macOS-AppleSilicon-update.app.tar.gz.sig
bundle-x86_64-apple-darwin         *.app.tar.gz              macOS-Intel-update.app.tar.gz
bundle-x86_64-apple-darwin         *.app.tar.gz.sig          macOS-Intel-update.app.tar.gz.sig
pedimap2-manual                    pedimap2-manual.pdf       User-Manual.pdf
'

# ── Updater table (latest.json) ──────────────────────────────────────────────
# One row per platform key the Tauri updater looks up. The signature is read
# from the raw .sig file; the download URL points at the PUBLISHED name above.
# Windows and Linux .sig files are only embedded here, not uploaded.
#
# platform        artifact                           signature glob                download (published)
UPDATER='
darwin-aarch64    bundle-aarch64-apple-darwin        *.app.tar.gz.sig              macOS-AppleSilicon-update.app.tar.gz
darwin-x86_64     bundle-x86_64-apple-darwin         *.app.tar.gz.sig              macOS-Intel-update.app.tar.gz
windows-x86_64    bundle-x86_64-pc-windows-msvc      *_{V}_x64-setup.exe.sig       Windows-Installer.exe
linux-x86_64      bundle-x86_64-unknown-linux-gnu    *_{V}_amd64.AppImage.sig      Linux-x86_64.AppImage
'

# Files without the version in their name, by design.
UNVERSIONED='SHA256SUMS.txt latest.json'

# ─────────────────────────────────────────────────────────────────────────────

if [ $# -ne 4 ]; then
  echo "usage: $0 VERSION INPUT_DIR OUTPUT_DIR NOTES_FILE" >&2
  exit 2
fi
VERSION=$1 INPUT=$2 OUTPUT=$3 NOTES=$4

errors=0
error() {
  # ::error:: makes the message show up in the GitHub Actions run summary.
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::error::$*" >&2; else echo "ERROR: $*" >&2; fi
  errors=$((errors + 1))
}
bail_if_errors() {
  if [ "$errors" -gt 0 ]; then
    echo "$errors problem(s) found; no release files were produced." >&2
    exit 1
  fi
}

if ! printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  error "VERSION must look like 2.1.1 (no leading v), got '$VERSION'"
fi
[ -d "$INPUT" ] || error "input folder '$INPUT' does not exist"
if [ -e "$OUTPUT" ] && [ -n "$(ls -A "$OUTPUT")" ]; then
  error "output folder '$OUTPUT' is not empty"
fi
bail_if_errors
mkdir -p "$OUTPUT"
# OUTPUT was empty or absent (checked above), so on any failure remove it
# rather than leave a half-renamed set that could be uploaded by mistake.
cleanup_on_failure() {
  local status=$?
  if [ "$status" -ne 0 ]; then rm -rf "$OUTPUT"; fi
  exit "$status"
}
trap cleanup_on_failure EXIT

# find_one ARTIFACT GLOB → prints the single matching path, or records an error.
find_one() {
  local dir="$INPUT/$1" glob=${2//\{V\}/$VERSION} matches count
  if [ ! -d "$dir" ]; then
    error "artifact '$1' is missing (expected folder $dir)"
    return 1
  fi
  matches=$(find "$dir" -type f -name "$glob")
  count=$(printf '%s' "$matches" | grep -c . || true)
  if [ "$count" -ne 1 ]; then
    error "expected exactly 1 file matching '$glob' in artifact '$1', found $count${matches:+: $(echo "$matches" | tr '\n' ' ')}"
    return 1
  fi
  printf '%s\n' "$matches"
}

sha256() {
  if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}

# ── 1. Copy and rename ───────────────────────────────────────────────────────
while read -r artifact glob published; do
  [ -n "$artifact" ] || continue
  if src=$(find_one "$artifact" "$glob"); then
    dest="Pedimap2-$VERSION-$published"
    cp "$src" "$OUTPUT/$dest"
    printf '  %-45s ← %s\n' "$dest" "${src#"$INPUT"/}"
  else
    errors=$((errors + 1))   # find_one ran in a subshell; count it here too
  fi
done <<EOF
$ASSETS
EOF
bail_if_errors

# ── 2. latest.json ───────────────────────────────────────────────────────────
# Format: https://v2.tauri.app/plugin/updater/#static-json-file
manifest=$(jq -n \
  --arg version "$VERSION" \
  --arg notes "See $REPO_URL/releases/tag/v$VERSION" \
  --arg pub_date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{version: $version, notes: $notes, pub_date: $pub_date, platforms: {}}')

while read -r platform artifact glob published; do
  [ -n "$platform" ] || continue
  download="Pedimap2-$VERSION-$published"
  [ -f "$OUTPUT/$download" ] || error "latest.json: $platform points at $download, which is not in the release"
  if sig=$(find_one "$artifact" "$glob"); then
    if [ ! -s "$sig" ]; then
      error "latest.json: signature file for $platform is empty: $sig"
      continue
    fi
    manifest=$(printf '%s' "$manifest" | jq \
      --arg platform "$platform" \
      --rawfile signature "$sig" \
      --arg url "$REPO_URL/releases/download/v$VERSION/$download" \
      '.platforms[$platform] = {signature: ($signature | rtrimstr("\n")), url: $url}')
  else
    errors=$((errors + 1))
  fi
done <<EOF
$UPDATER
EOF
bail_if_errors
printf '%s\n' "$manifest" > "$OUTPUT/latest.json"

# ── 3. Every published name must carry the version ───────────────────────────
for f in "$OUTPUT"/*; do
  name=$(basename "$f")
  case " $UNVERSIONED " in *" $name "*) continue ;; esac
  case "$name" in
    *"-$VERSION-"*) ;;
    *) error "published file '$name' does not contain the version $VERSION" ;;
  esac
done
bail_if_errors

# ── 4. Checksums (last, so they cover latest.json too) ───────────────────────
(
  cd "$OUTPUT"
  sums=$(for f in *; do sha256 "$f"; done)   # glob order is sorted
  printf '%s\n' "$sums" > SHA256SUMS.txt
)

# ── 5. Release notes ─────────────────────────────────────────────────────────
# "What's new" is the CHANGELOG.md section headed "## [VERSION]", up to the
# next "## [" heading or the link references at the bottom.
whats_new=$(awk -v heading="## [$VERSION]" '
  index($0, "## [") == 1 { if (found) exit; if (index($0, heading) == 1) { found = 1; next } }
  /^\[[^]]+\]: / { if (found) exit }
  found && $0 != "---" { print }
' "$CHANGELOG" | sed -e '/./,$!d' | awk '{ lines[NR] = $0 } /./ { last = NR } END { for (i = 1; i <= last; i++) print lines[i] }')
if [ -z "$whats_new" ]; then
  error "CHANGELOG.md has no '## [$VERSION]' section (or it is empty); add one before releasing"
fi
bail_if_errors

WHATS_NEW=$whats_new VERSION=$VERSION awk '
  function replace_all(s, from, to,    out, i) {
    out = ""
    while ((i = index(s, from)) > 0) { out = out substr(s, 1, i - 1) to; s = substr(s, i + length(from)) }
    return out s
  }
  $0 == "{{WHATS_NEW}}" { print ENVIRON["WHATS_NEW"]; next }
  { print replace_all($0, "{{VERSION}}", ENVIRON["VERSION"]) }
' "$NOTES_TEMPLATE" > "$NOTES"
if grep -n '{{' "$NOTES" >&2; then
  error "release notes still contain an unreplaced {{placeholder}} (see lines above)"
fi
bail_if_errors

echo
echo "Release files for v$VERSION in $OUTPUT:"
(cd "$OUTPUT" && ls -l)
