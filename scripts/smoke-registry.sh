#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
set -euo pipefail
REG="${PLOYDOK_REGISTRY_URL:-127.0.0.1:5000}"

echo "==> Pulling hello-world..."
docker pull hello-world:latest

echo "==> Tagging for local registry..."
docker tag hello-world:latest "${REG}/smoke:test"

echo "==> Pushing..."
docker push "${REG}/smoke:test"

echo "==> Listing tags..."
curl -sf "http://${REG}/v2/smoke/tags/list" | tee /dev/stderr

echo "==> Deleting via API..."
MANIFEST=$(curl -sf -H "Accept: application/vnd.docker.distribution.manifest.v2+json" -D - "http://${REG}/v2/smoke/manifests/test" | grep -i '^docker-content-digest' | awk '{print $2}' | tr -d $'\r')
if [ -n "${MANIFEST:-}" ]; then
  curl -sf -X DELETE "http://${REG}/v2/smoke/manifests/${MANIFEST}" || true
fi

echo "==> Smoke OK"
