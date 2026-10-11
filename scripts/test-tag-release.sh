#!/usr/bin/env bash
#
# Tests scripts/tag-release.sh against a throwaway repository whose "origin"
# is a local bare repository, so nothing is ever pushed anywhere real: every
# refusal, then one real tag-and-push.

set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tag-release.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git_() { git -c user.name=Test -c user.email=test@example.com -c init.defaultBranch=main "$@"; }

# A repository with the four version files and a CHANGELOG at $1, pushed to
# a bare "origin".
git_ init -q --bare "$work/origin.git"
git_ clone -q "$work/origin.git" "$work/repo" 2>/dev/null
cd "$work/repo"
set_version() {
  local v=$1
  mkdir -p frontend src-tauri
  printf '{\n  "name": "pedimap2",\n  "version": "%s"\n}\n' "$v" > package.json
  printf '{\n  "name": "pedimap2-frontend",\n  "version": "%s"\n}\n' "$v" > frontend/package.json
  printf '[package]\nname = "pedimap2"\nversion = "%s"\n\n[dependencies]\nserde = { version = "1" }\n' "$v" > src-tauri/Cargo.toml
  printf '{\n  "productName": "Pedimap 2",\n  "version": "%s"\n}\n' "$v" > src-tauri/tauri.conf.json
}
set_version 1.2.3
printf '# Changelog\n\n## [Unreleased]\n\n## [1.2.3] — 2026-01-01\n\n### Fixed\n- Something.\n\n## [1.2.2] — 2025-12-01\n\n- Older.\n' > CHANGELOG.md
git_ add -A && git_ commit -q -m "release 1.2.3" && git_ push -q origin main

expect() {   # expect pass|fail "<message to find>" <args...>
  local want=$1 needle=$2; shift 2
  if out=$("$SCRIPT" "$@" 2>&1); then got=pass; else got=fail; fi
  if [ "$got" != "$want" ] || ! grep -qF -- "$needle" <<<"$out"; then
    printf 'FAIL: tag-release.sh %s (expected %s with "%s", got %s):\n%s\n' "$*" "$want" "$needle" "$got" "$out" >&2
    exit 1
  fi
  printf 'ok   %-58s %s\n' "$*" "$needle"
}

# Arguments
expect fail "usage:"
expect fail "without the leading v"        v1.2.3
expect fail "not a version of the form"    1.2

# Branch
git_ switch -q -c feature
expect fail "the current branch is feature, not main" 1.2.3
git_ switch -q main

# Clean tree: changed, staged, untracked
echo "x" >> CHANGELOG.md
expect fail "working tree is not clean"    1.2.3
git_ checkout -q -- CHANGELOG.md
echo "new" > notes.txt
expect fail "working tree is not clean"    1.2.3
git_ add notes.txt
expect fail "working tree is not clean"    1.2.3
git_ rm -q --cached notes.txt && rm notes.txt

# In sync with origin: behind, then ahead
git_ clone -q "$work/origin.git" "$work/other" 2>/dev/null
(cd "$work/other" && echo "elsewhere" > other.txt && git_ add -A && git_ commit -q -m "elsewhere" && git_ push -q origin main)
expect fail "1 commit(s) behind origin/main" 1.2.3
git_ pull -q --ff-only
echo "local" > local.txt && git_ add -A && git_ commit -q -m "local only"
expect fail "1 commit(s) not on origin/main" 1.2.3
git_ reset -q --hard origin/main

# Version files: each one checked on its own
for f in package.json frontend/package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json; do
  cp "$f" "$work/saved"                                  # outside the repository
  sed -i.tmp 's/1\.2\.3/1.2.4/' "$f" && rm -f "$f.tmp"
  git_ commit -q -am "bump $f" && git_ push -q origin main
  expect fail "$f has 1.2.4"                1.2.3
  cp "$work/saved" "$f" && git_ commit -q -am "restore $f" && git_ push -q origin main
done
expect fail "the version files do not all say 1.2.4" 1.2.4

# Release notes: missing section, empty section
set_version 1.3.0
git_ commit -q -am "bump to 1.3.0 without notes" && git_ push -q origin main
expect fail "no '## [1.3.0]' section"      1.3.0
sed -i.tmp 's/^## \[Unreleased\]/## [Unreleased]\n\n## [1.3.0] — 2026-02-01/' CHANGELOG.md && rm -f CHANGELOG.md.tmp
git_ commit -q -am "empty 1.3.0 section" && git_ push -q origin main
expect fail "no '## [1.3.0]' section"      1.3.0
sed -i.tmp 's/^## \[1\.3\.0\] — 2026-02-01$/## [1.3.0] — 2026-02-01\n\n- New./' CHANGELOG.md && rm -f CHANGELOG.md.tmp
git_ commit -q -am "notes for 1.3.0" && git_ push -q origin main

# Everything right: --check creates nothing, then a real tag and push
expect pass "--check given, so no tag was created" --check 1.3.0
[ -z "$(git tag -l v1.3.0)" ] || { echo "FAIL: --check created a tag" >&2; exit 1; }
expect pass "Tagged"                       1.3.0
head=$(git rev-parse HEAD)
[ "$(git -C "$work/origin.git" rev-parse 'v1.3.0^{commit}')" = "$head" ] || { echo "FAIL: origin's v1.3.0 is not HEAD" >&2; exit 1; }
[ "$(git -C "$work/origin.git" cat-file -t v1.3.0)" = tag ] || { echo "FAIL: v1.3.0 is not an annotated tag" >&2; exit 1; }
[ "$(git -C "$work/origin.git" tag -l --format='%(contents:subject)' v1.3.0)" = "Pedimap 2 1.3.0" ] || { echo "FAIL: wrong tag message" >&2; exit 1; }
printf 'ok   %-58s %s\n' "(origin)" "v1.3.0 is an annotated tag on HEAD, message 'Pedimap 2 1.3.0'"

# A tag that exists, here or only on origin
expect fail "tag v1.3.0 already exists here" 1.3.0
git_ tag -d v1.3.0 >/dev/null
expect fail "tag v1.3.0 already exists on origin" 1.3.0

echo "All tag-release.sh checks passed."
