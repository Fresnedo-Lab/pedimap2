#!/usr/bin/env bash
#
# Tests scripts/check-developer-id-issuer.sh with throwaway certificates that
# imitate Apple's: one signed by a "G2" authority (must pass), one by the
# original authority (must fail), and the authority's own certificate, which
# is issued by a root with OU "Apple Certification Authority" and must never be
# mistaken for the signing certificate. On macOS it also checks the keychain
# mode against a temporary keychain.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="$SCRIPT_DIR/check-developer-id-issuer.sh"
work=$(mktemp -d)
keychain="$work/test.keychain-db"
cleanup() {
  [ "$(uname)" = Darwin ] && security delete-keychain "$keychain" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

# A CA named like Apple's Developer ID authority, with the given OU, signed by a
# root whose OU is "Apple Certification Authority"; then a leaf it issues.
make_chain() {   # make_chain <name> <authority-OU>
  local name=$1 ou=$2
  openssl req -x509 -newkey rsa:2048 -nodes -days 2 -keyout "$work/$name-root.key" -out "$work/$name-root.pem" \
    -subj "/CN=Test Root CA/OU=Apple Certification Authority/O=Test/C=US" 2>/dev/null
  openssl req -newkey rsa:2048 -nodes -keyout "$work/$name-ca.key" -out "$work/$name-ca.csr" \
    -subj "/CN=Developer ID Certification Authority/OU=$ou/O=Test/C=US" 2>/dev/null
  printf 'basicConstraints=critical,CA:true\n' > "$work/ca.ext"
  openssl x509 -req -in "$work/$name-ca.csr" -CA "$work/$name-root.pem" -CAkey "$work/$name-root.key" \
    -CAcreateserial -days 2 -extfile "$work/ca.ext" -out "$work/$name-ca.pem" 2>/dev/null
  openssl req -newkey rsa:2048 -nodes -keyout "$work/$name-leaf.key" -out "$work/$name-leaf.csr" \
    -subj "/CN=Developer ID Application: Test Lab ($name)/OU=TEAMID1234/O=Test Lab/C=US" 2>/dev/null
  openssl x509 -req -in "$work/$name-leaf.csr" -CA "$work/$name-ca.pem" -CAkey "$work/$name-ca.key" \
    -CAcreateserial -days 2 -out "$work/$name-leaf.pem" 2>/dev/null
}

expect() {       # expect pass|fail <description> <command...>
  local want=$1 what=$2; shift 2
  if out=$("$@" 2>&1); then got=pass; else got=fail; fi
  if [ "$got" != "$want" ]; then
    printf 'FAIL: %s (expected %s, got %s)\n%s\n' "$what" "$want" "$got" "$out" >&2
    exit 1
  fi
  printf 'ok   %s\n' "$what"
  last_output=$out
}

make_chain g2 "G2"
make_chain original "Apple Certification Authority"

expect pass "G2-issued certificate is accepted" "$CHECK" --pem "$work/g2-leaf.pem"
expect fail "certificate from the original authority is rejected" "$CHECK" --pem "$work/original-leaf.pem"
case $last_output in
  *"February 1, 2027"*"replace-developer-id-certificates"*) printf 'ok   rejection explains the deadline and links Apple'"'"'s help\n' ;;
  *) printf 'FAIL: rejection message lacks the deadline or the help link:\n%s\n' "$last_output" >&2; exit 1 ;;
esac
expect fail "the authority's own certificate is not a signing certificate" "$CHECK" --pem "$work/g2-ca.pem"

if [ "$(uname)" = Darwin ]; then
  # Keychain mode: both authorities' certificates and both leaves present, as
  # in a real keychain; the identity name selects the leaf.
  security create-keychain -p test "$keychain"
  for f in g2-ca original-ca original-leaf g2-leaf; do
    security import "$work/$f.pem" -k "$keychain" >/dev/null
  done
  expect pass "keychain: picks the G2 leaf by identity" \
    "$CHECK" "$keychain" "Developer ID Application: Test Lab (g2)"
  expect fail "keychain: rejects the original authority's leaf" \
    "$CHECK" "$keychain" "Developer ID Application: Test Lab (original)"
  expect fail "keychain: missing identity is an error" \
    "$CHECK" "$keychain" "Developer ID Application: Nobody"
fi
echo "All Developer ID issuer checks passed."
