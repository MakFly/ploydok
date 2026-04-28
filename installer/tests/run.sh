#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

assert_file() {
  [[ -f "$1" ]] || { echo "missing file: $1" >&2; exit 1; }
}

assert_contains() {
  local file="$1" needle="$2"
  grep -Fq "$needle" "$file" || { echo "expected $file to contain $needle" >&2; exit 1; }
}

assert_not_exists() {
  [[ ! -e "$1" ]] || { echo "expected $1 to be absent" >&2; exit 1; }
}

PLOYDOK_INSTALL_DRY_RUN=1 \
PLOYDOK_INSTALL_ROOT="$TMP/root" \
PLOYDOK_PUBLIC_HOST="ploydok.test" \
bash "$ROOT/installer/install.sh" \
  --mode=coexist \
  --http-port=18080 \
  --https-port=18443 \
  --data-dir=/var/lib/ploydok \
  --skip-docker-install \
  --yes \
  --version=test

assert_file "$TMP/root/var/lib/ploydok/docker-compose.yml"
assert_file "$TMP/root/var/lib/ploydok/.env"
assert_file "$TMP/root/etc/nginx/snippets/ploydok.conf"
assert_file "$TMP/root/etc/apache2/conf-available/ploydok.conf"
assert_file "$TMP/root/etc/systemd/system/ploydok.service"
assert_contains "$TMP/root/var/lib/ploydok/docker-compose.yml" "127.0.0.1:18080:80"
assert_contains "$TMP/root/etc/nginx/snippets/ploydok.conf" "proxy_pass http://127.0.0.1:18080;"
assert_contains "$TMP/root/var/lib/ploydok/docker-compose.yml" 'POSTGRES_PASSWORD: ${PLOYDOK_PG_PASSWORD}'
assert_contains "$TMP/root/var/lib/ploydok/docker-compose.yml" '"${PLOYDOK_REDIS_PASSWORD}"'

master_key_before="$(cat "$TMP/root/var/lib/ploydok/master.key")"
env_before="$(cat "$TMP/root/var/lib/ploydok/.env")"

PLOYDOK_INSTALL_DRY_RUN=1 \
PLOYDOK_INSTALL_ROOT="$TMP/root" \
PLOYDOK_PUBLIC_HOST="ploydok.test" \
bash "$ROOT/installer/install.sh" \
  --mode=coexist \
  --http-port=18080 \
  --https-port=18443 \
  --data-dir=/var/lib/ploydok \
  --skip-docker-install \
  --yes \
  --version=test

[[ "$(cat "$TMP/root/var/lib/ploydok/master.key")" == "$master_key_before" ]] || {
  echo "master key changed on idempotent install" >&2
  exit 1
}
[[ "$(cat "$TMP/root/var/lib/ploydok/.env")" == "$env_before" ]] || {
  echo ".env changed on idempotent install" >&2
  exit 1
}

PLOYDOK_INSTALL_DRY_RUN=1 PLOYDOK_INSTALL_ROOT="$TMP/root" PLOYDOK_INSTALL_SKIP_COSIGN=1 \
bash "$ROOT/installer/ploydok-cli" upgrade --data-dir=/var/lib/ploydok --version=test2

PLOYDOK_INSTALL_DRY_RUN=1 PLOYDOK_INSTALL_ROOT="$TMP/root" \
bash "$ROOT/installer/ploydok-cli" uninstall --data-dir=/var/lib/ploydok --yes --restore-previous-proxy

PLOYDOK_INSTALL_DRY_RUN=1 \
PLOYDOK_INSTALL_ROOT="$TMP/takeover-root" \
bash "$ROOT/installer/install.sh" \
  --mode=takeover \
  --data-dir=/var/lib/ploydok \
  --skip-docker-install \
  --yes \
  --version=test

assert_contains "$TMP/takeover-root/var/lib/ploydok/docker-compose.yml" '"80:80"'
assert_contains "$TMP/takeover-root/var/lib/ploydok/docker-compose.yml" '"443:443"'

set +e
PLOYDOK_INSTALL_DRY_RUN=1 \
PLOYDOK_INSTALL_ROOT="$TMP/abort-root" \
bash "$ROOT/installer/install.sh" --mode=abort --skip-docker-install --yes >/dev/null 2>&1
abort_status=$?
set -e
[[ "$abort_status" -eq 2 ]] || { echo "abort mode returned $abort_status, expected 2" >&2; exit 1; }
assert_not_exists "$TMP/abort-root/var/lib/ploydok/docker-compose.yml"

echo "installer tests OK"
