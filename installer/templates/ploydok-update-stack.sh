#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -Eeuo pipefail

STACK_FILE="${PLOYDOK_INSTALL_DIR}/docker-stack.yml"
IDENTITY_REGEX='^https://github\.com/MakFly/ploydok/\.github/workflows/release-images\.yml@.*$'

command -v cosign >/dev/null 2>&1 || {
  echo "ploydok update refused: cosign is required" >&2
  exit 3
}

mapfile -t images < <(awk '$1 == "image:" { print $2 }' "$STACK_FILE" | sort -u)
[[ "${#images[@]}" -gt 0 ]] || {
  echo "ploydok update refused: no images found in $STACK_FILE" >&2
  exit 2
}

for image in "${images[@]}"; do
  cosign verify \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com \
    --certificate-identity-regexp "$IDENTITY_REGEX" \
    "$image" >/dev/null
  docker pull "$image"
done

docker stack deploy \
  --resolve-image always \
  --with-registry-auth \
  --prune \
  -c "$STACK_FILE" \
  ploydok
