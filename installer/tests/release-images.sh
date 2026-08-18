#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/install" "$TMP/data"
touch "$TMP/install/docker-compose.yml" "$TMP/data/.env"

digest="sha256:$(printf 'b%.0s' {1..64})"
manifest="$TMP/release-images.env"
cat >"$manifest" <<EOF
PLOYDOK_API_IMAGE=ghcr.io/makfly/ploydok-api@$digest
PLOYDOK_WEB_IMAGE=ghcr.io/makfly/ploydok-web@$digest
PLOYDOK_AGENT_IMAGE=ghcr.io/makfly/ploydok-agent@$digest
PLOYDOK_ADMINER_IMAGE=ghcr.io/makfly/ploydok-adminer@$digest
PLOYDOK_CADDY_IMAGE=ghcr.io/makfly/ploydok-caddy@$digest
EOF

cat >"$TMP/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$1" == "compose" ]]; then
  service="${@: -1}"
  printf 'container-%s\n' "$service"
elif [[ "$1" == "inspect" ]]; then
  service="${@: -1}"
  service="${service#container-}"
  key="PLOYDOK_${service^^}_IMAGE"
  value="$(awk -F= -v key="$key" '$1 == key { print $2 }' "$FAKE_RELEASE_MANIFEST")"
  [[ "${FAKE_RELEASE_MISMATCH:-}" != "$service" ]] || value="${value%sha256:*}sha256:$(printf 'c%.0s' {1..64})"
  printf '%s\n' "$value"
elif [[ "$1" == "service" && "$2" == "inspect" ]]; then
  service="${@: -1}"
  service="${service#ploydok_}"
  key="PLOYDOK_${service^^}_IMAGE"
  awk -F= -v key="$key" '$1 == key { print $2 }' "$FAKE_RELEASE_MANIFEST"
else
  echo "unexpected docker invocation: $*" >&2
  exit 2
fi
EOF
chmod +x "$TMP/bin/docker"

PATH="$TMP/bin:$PATH" FAKE_RELEASE_MANIFEST="$manifest" \
  bash "$ROOT/installer/verify-release-images" "$manifest" "$TMP/install" "$TMP/data" >/dev/null

if PATH="$TMP/bin:$PATH" FAKE_RELEASE_MANIFEST="$manifest" FAKE_RELEASE_MISMATCH=caddy \
  bash "$ROOT/installer/verify-release-images" "$manifest" "$TMP/install" "$TMP/data" >/dev/null 2>&1; then
  echo "release verifier accepted a mismatched active digest" >&2
  exit 1
fi

rm "$TMP/install/docker-compose.yml"
touch "$TMP/install/docker-stack.yml"
PATH="$TMP/bin:$PATH" FAKE_RELEASE_MANIFEST="$manifest" \
  bash "$ROOT/installer/verify-release-images" "$manifest" "$TMP/install" "$TMP/data" >/dev/null

workflow="$ROOT/.github/workflows/release-images.yml"
grep -q 'group: release-images-promotion' "$workflow" || {
  echo "release promotion must be serialized across SHAs and versions" >&2
  exit 1
}
if grep -n '\${{ inputs\.version }}' "$workflow" | grep -q 'run:'; then
  echo "workflow input must not be interpolated directly into shell source" >&2
  exit 1
fi

echo "release image manifest tests OK"
