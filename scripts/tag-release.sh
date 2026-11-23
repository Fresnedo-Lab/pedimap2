#!/usr/bin/env bash
#
# tag-release.sh
# ==============
# The only way to tag a release. Creates and pushes the annotated tag
# vVERSION, which starts the release workflow, but only when the commit is
# the one that should be released:
#
#   - the current branch is main, or maint/X.Y for a version X.Y.Z (a patch
#     of an older minor version, e.g. 2.3.1 on maint/2.3 while main heads
#     for 2.4.0);
#   - the working tree is clean (no changed, staged or untracked files);
#   - the branch is in sync with its origin (nothing to pull, nothing
#     unpushed);
#   - package.json, frontend/package.json, src-tauri/Cargo.toml and
#     src-tauri/tauri.conf.json all have version VERSION;
#   - CHANGELOG.md has a non-empty "## [VERSION]" section (the release notes);
#   - git knows who is tagging (user.name and user.email);
#   - the tag vVERSION does not exist yet, here or on origin.
#
# Usage:
#   scripts/tag-release.sh VERSION            e.g. scripts/tag-release.sh 2.2.3
#   scripts/tag-release.sh --check VERSION    run the checks, create nothing
#
# Run it from anywhere inside the repository, after the release PR is merged.

set -euo pipefail

check_only=false
if [ "${1:-}" = "--check" ]; then
  check_only=true
  shift
fi
version=${1:-}

refuse() {
  echo "Refusing to tag: $*" >&2
  exit 1
}
ok() { echo "  ok  $*"; }

[ $# -eq 1 ] || refuse "usage: $0 [--check] VERSION   (for example: $0 2.2.3)"
case $version in
  v*) refuse "give the version without the leading v: $0 ${version#v}" ;;
esac
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || refuse "'$version' is not a version of the form X.Y.Z"
tag="v$version"

root=$(git rev-parse --show-toplevel 2>/dev/null) || refuse "not inside a git repository"
cd "$root"
echo "Checking $tag in $root"

# ── Branch ────────────────────────────────────────────────────────────────────
# main, or the maintenance branch of this version's minor version.
branch=$(git symbolic-ref --quiet --short HEAD || echo "(detached HEAD)")
maint="maint/${version%.*}"
[ "$branch" = main ] || [ "$branch" = "$maint" ] ||
  refuse "the current branch is $branch, not main or $maint (git switch main && git pull)"
ok "on $branch"

# ── Clean working tree ────────────────────────────────────────────────────────
if [ -n "$(git status --porcelain)" ]; then
  git status --short >&2
  refuse "the working tree is not clean (changed, staged or untracked files above)"
fi
ok "working tree clean"

# ── In sync with origin ───────────────────────────────────────────────────────
git fetch --quiet origin "$branch" || refuse "could not fetch origin/$branch"
read -r ahead behind < <(git rev-list --left-right --count "HEAD...origin/$branch")
[ "$behind" -eq 0 ] || refuse "$branch is $behind commit(s) behind origin/$branch (git pull)"
[ "$ahead" -eq 0 ] || refuse "$branch has $ahead commit(s) not on origin/$branch; merge through a pull request instead"
ok "$branch is in sync with origin/$branch ($(git rev-parse --short HEAD))"

# ── Version files ─────────────────────────────────────────────────────────────
# Read the same way as the release workflow's "Check tag against version files".
json_version() { node -p "require('./$1').version"; }
cargo_version() { sed -n '/^\[package\]/,/^\[/ s/^version *= *"\(.*\)".*/\1/p' "$1"; }
mismatched=()
for file in package.json frontend/package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json; do
  [ -f "$file" ] || refuse "$file is missing"
  case $file in
    *.toml) found=$(cargo_version "$file") ;;
    *)      found=$(json_version "$file") ;;
  esac
  [ "$found" = "$version" ] || mismatched+=("$file has ${found:-no version}")
done
[ ${#mismatched[@]} -eq 0 ] || refuse "the version files do not all say $version: $(IFS=';'; echo "${mismatched[*]}" | sed 's/;/; /g')"
ok "all four version files say $version"

# ── Release notes ─────────────────────────────────────────────────────────────
# The release workflow copies this section into the release notes and fails
# without it (scripts/release-assets.sh, changelog_section).
notes=$(awk -v heading="## [$version]" '
  index($0, "## [") == 1 { if (found) exit; if (index($0, heading) == 1) { found = 1; next } }
  /^\[[^]]+\]: / { if (found) exit }
  found && $0 != "---" && NF { print }' CHANGELOG.md 2>/dev/null || true)
[ -n "$notes" ] || refuse "CHANGELOG.md has no '## [$version]' section with content (the release notes)"
ok "CHANGELOG.md has a [$version] section"

# ── Who tags ──────────────────────────────────────────────────────────────────
# An annotated tag records its tagger. Require an identity that was set on
# purpose: otherwise git invents one from the account and host name, or fails.
tagger_name=${GIT_COMMITTER_NAME:-$(git config user.name || true)}
tagger_email=${GIT_COMMITTER_EMAIL:-$(git config user.email || true)}
[ -n "$tagger_name" ] && [ -n "$tagger_email" ] ||
  refuse "git does not know who you are: set git config user.name and user.email"
ok "tagger: $tagger_name <$tagger_email>"

# ── Tag not taken ─────────────────────────────────────────────────────────────
if git rev-parse --quiet --verify "refs/tags/$tag" >/dev/null; then
  refuse "tag $tag already exists here (git tag -d $tag if it was a mistake and never pushed)"
fi
if [ -n "$(git ls-remote --tags origin "refs/tags/$tag")" ]; then
  refuse "tag $tag already exists on origin"
fi
ok "tag $tag is free"

if $check_only; then
  echo "All checks passed; --check given, so no tag was created."
  exit 0
fi

# ── Tag and push ──────────────────────────────────────────────────────────────
git tag -a "$tag" -m "Pedimap 2 $version"
if ! git push origin "refs/tags/$tag"; then
  git tag -d "$tag" >/dev/null
  refuse "pushing $tag failed; the local tag was removed again"
fi
echo "Tagged $(git rev-parse --short HEAD) as $tag and pushed it; the release workflow has started."
url=$(git remote get-url origin | sed -E 's#^git@github.com:#https://github.com/#; s#\.git$##')
case $url in https://github.com/*) echo "Watch it at $url/actions" ;; esac
