#!/usr/bin/env bash
#
# check-developer-id-issuer.sh
# ============================
# Fails unless the Developer ID signing certificate was issued by Apple's
# current authority, "Developer ID Certification Authority" with
# Organizational Unit G2.
#
# Apple's original Developer ID authority expires on February 1, 2027; after
# that, certificates it issued can no longer sign and must be replaced:
# https://developer.apple.com/help/account/certificates/replace-developer-id-certificates
#
# Usage:
#   scripts/check-developer-id-issuer.sh <keychain> [signing-identity]
#       Checks the certificate whose name contains <signing-identity>
#       (default "Developer ID Application") in <keychain>. Release workflow,
#       right after the certificate is imported.
#   scripts/check-developer-id-issuer.sh --pem <certificate.pem>
#       Checks a PEM certificate file (used by the tests).
#
# The authority's own certificate ("Developer ID Certification Authority",
# issued by Apple Root CA, OU "Apple Certification Authority") is never the
# one checked: its name does not contain "Developer ID Application".

set -euo pipefail

HELP_URL="https://developer.apple.com/help/account/certificates/replace-developer-id-certificates"

fail() {
  # ::error:: shows as an annotation on GitHub Actions; plain text elsewhere.
  echo "::error::$*" >&2
  exit 1
}

if [ "${1:-}" = "--pem" ]; then
  [ $# -eq 2 ] || fail "usage: $0 --pem <certificate.pem>"
  pem=$(cat "$2")
else
  [ $# -ge 1 ] || fail "usage: $0 <keychain> [signing-identity]"
  keychain=$1
  identity=${2:-}
  [ -n "$identity" ] || identity="Developer ID Application"
  pem=$(security find-certificate -c "$identity" -p "$keychain" 2>/dev/null || true)
  [ -n "$pem" ] || fail "No certificate named like '$identity' in $keychain."
fi

subject=$(printf '%s\n' "$pem" | openssl x509 -noout -subject -nameopt RFC2253 | sed 's/^subject= *//')
issuer=$(printf '%s\n' "$pem" | openssl x509 -noout -issuer -nameopt RFC2253 | sed 's/^issuer= *//')
# Organizational Unit(s) of the issuer, e.g. "G2" or "Apple Certification Authority".
issuer_ou=$(printf '%s\n' "$issuer" | tr ',' '\n' | sed -n 's/^ *OU=//p' | paste -sd ',' -)

echo "Signing certificate: $subject"
echo "Issued by:           $issuer"

if [ "$issuer_ou" = "G2" ]; then
  echo "OK: issued by the current Developer ID authority (G2)."
  exit 0
fi

fail "The signing certificate was issued by '$issuer' (Organizational Unit '${issuer_ou:-none}'), not by \
Apple's current Developer ID Certification Authority (G2). Developer ID certificates from the original \
authority cannot sign after February 1, 2027 and must be replaced: create a new Developer ID Application \
certificate, choosing the G2 Sub-CA, then update the APPLE_CERTIFICATE, APPLE_CERTIFICATE_PASSWORD and \
APPLE_SIGNING_IDENTITY secrets. See $HELP_URL"
