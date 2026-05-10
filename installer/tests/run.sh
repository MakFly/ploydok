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

assert_text_contains() {
  local text="$1" needle="$2"
  grep -Fq "$needle" <<<"$text" || { echo "expected text to contain $needle" >&2; exit 1; }
}

assert_text_not_contains() {
  local text="$1" needle="$2"
  ! grep -Fq "$needle" <<<"$text" || { echo "expected text not to contain $needle" >&2; exit 1; }
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

assert_file "$TMP/root/opt/ploydok/docker-compose.yml"
assert_file "$TMP/root/opt/ploydok/Caddyfile"
assert_file "$TMP/root/var/lib/ploydok/.env"
assert_file "$TMP/root/var/lib/ploydok/config/buildkitd.toml"
assert_file "$TMP/root/etc/nginx/snippets/ploydok.conf"
assert_file "$TMP/root/etc/apache2/conf-available/ploydok.conf"
assert_file "$TMP/root/etc/systemd/system/ploydok.service"
assert_not_exists "$TMP/root/var/lib/ploydok/docker-compose.yml"
assert_not_exists "$TMP/root/var/lib/ploydok/postgres"
assert_not_exists "$TMP/root/var/lib/ploydok/redis"
assert_not_exists "$TMP/root/var/lib/ploydok/registry"
assert_not_exists "$TMP/root/var/lib/ploydok/caddy"
assert_contains "$TMP/root/opt/ploydok/docker-compose.yml" "127.0.0.1:18080:80"
assert_contains "$TMP/root/opt/ploydok/docker-compose.yml" "ploydok-web:test"
assert_contains "$TMP/root/opt/ploydok/docker-compose.yml" "PLOYDOK_AGENT_ADDR: 0.0.0.0:50051"
assert_contains "$TMP/root/opt/ploydok/docker-compose.yml" "postgres-data:/var/lib/postgresql/data"
assert_contains "$TMP/root/opt/ploydok/docker-compose.yml" "redis-data:/data"
assert_contains "$TMP/root/opt/ploydok/docker-compose.yml" "registry-data:/var/lib/registry"
assert_contains "$TMP/root/opt/ploydok/docker-compose.yml" "moby/buildkit:v0.29.0-rootless"
assert_contains "$TMP/root/opt/ploydok/docker-compose.yml" "buildkit-cache:/home/user/.local/share/buildkit"
assert_contains "$TMP/root/opt/ploydok/docker-compose.yml" "/var/run/docker.sock:/var/run/docker.sock"
assert_contains "$TMP/root/opt/ploydok/docker-compose.yml" "ploydok.kind: infra"
assert_contains "$TMP/root/opt/ploydok/docker-compose.yml" "ploydok.component: caddy"
assert_contains "$TMP/root/opt/ploydok/docker-compose.yml" "caddy-data:/data"
assert_contains "$TMP/root/opt/ploydok/docker-compose.yml" "caddy-config:/config"
assert_contains "$TMP/root/opt/ploydok/Caddyfile" "https://ploydok.test"
assert_contains "$TMP/root/opt/ploydok/Caddyfile" "host localhost ploydok.local ploydok.test"
assert_contains "$TMP/root/opt/ploydok/Caddyfile" "route @control_plane"
assert_contains "$TMP/root/opt/ploydok/Caddyfile" "reverse_proxy web:3000"
assert_contains "$TMP/root/opt/ploydok/Caddyfile" "handle_path /api/*"
assert_contains "$TMP/root/var/lib/ploydok/.env" "WEB_ORIGIN=https://ploydok.test"
assert_contains "$TMP/root/var/lib/ploydok/.env" "GITHUB_APP_CALLBACK_URL=https://ploydok.test/github/app/callback"
assert_contains "$TMP/root/var/lib/ploydok/.env" "GITLAB_OAUTH_CALLBACK_URL=https://ploydok.test/gitlab/callback"
assert_contains "$TMP/root/var/lib/ploydok/.env" "PLOYDOK_DOMAIN_BASE=apps.ploydok.test"
assert_contains "$TMP/root/var/lib/ploydok/.env" "PLOYDOK_SETUP_TOKEN_REQUIRED=1"
assert_contains "$TMP/root/var/lib/ploydok/.env" "PLOYDOK_COOKIE_SECURE=auto"
assert_contains "$TMP/root/var/lib/ploydok/.env" "PLOYDOK_REGISTRY_URL=127.0.0.1:5000"
assert_contains "$TMP/root/var/lib/ploydok/.env" "PLOYDOK_REGISTRY_API_URL=registry:5000"
assert_contains "$TMP/root/var/lib/ploydok/.env" "PLOYDOK_BUILDKIT_ADDR=tcp://buildkitd:1234"
assert_contains "$TMP/root/var/lib/ploydok/.env" "PLOYDOK_AGENT_ADDR=agent:50051"
assert_contains "$TMP/root/var/lib/ploydok/config/buildkitd.toml" '[registry."registry:5000"]'
assert_contains "$TMP/root/var/lib/ploydok/config/validator.toml" 'allowed_registries = ['
assert_contains "$TMP/root/var/lib/ploydok/config/validator.toml" '"registry:5000"'
assert_contains "$TMP/root/var/lib/ploydok/config/validator.toml" 'volume_prefix = "/var/lib/ploydok/volumes"'
assert_contains "$TMP/root/var/lib/ploydok/config/validator.toml" 'app_volume_prefix = "/var/lib/ploydok/app-volumes"'
assert_contains "$TMP/root/var/lib/ploydok/.env" "PLOYDOK_AGENT_CLIENT_CERT=/var/lib/ploydok/pki/client.pem"
assert_contains "$TMP/root/etc/nginx/snippets/ploydok.conf" "proxy_pass http://127.0.0.1:18080;"
assert_contains "$TMP/root/opt/ploydok/docker-compose.yml" 'POSTGRES_PASSWORD: ${PLOYDOK_PG_PASSWORD}'
assert_contains "$TMP/root/opt/ploydok/docker-compose.yml" '"${PLOYDOK_REDIS_PASSWORD}"'

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

upgrade_output="$(
  PLOYDOK_INSTALL_DRY_RUN=1 PLOYDOK_INSTALL_ROOT="$TMP/root" PLOYDOK_INSTALL_SKIP_COSIGN=1 \
    bash "$ROOT/installer/ploydok-cli" upgrade --data-dir=/var/lib/ploydok --version=test2 2>&1
)"
assert_text_contains "$upgrade_output" "update $TMP/root/opt/ploydok/docker-compose.yml api/web/agent/adminer images to test2"
assert_text_contains "$upgrade_output" "pull api web agent adminer"
assert_text_contains "$upgrade_output" "up -d --no-deps api web agent adminer"
assert_text_contains "$upgrade_output" "run --rm --no-deps api bun run --cwd packages/db migrate"
assert_text_not_contains "$upgrade_output" "ploydok-caddy:test2"

upgrade_data_plane_output="$(
  PLOYDOK_INSTALL_DRY_RUN=1 PLOYDOK_INSTALL_ROOT="$TMP/root" PLOYDOK_INSTALL_SKIP_COSIGN=1 \
    bash "$ROOT/installer/ploydok-cli" upgrade --data-dir=/var/lib/ploydok --version=test3 --include-data-plane 2>&1
)"
assert_text_contains "$upgrade_data_plane_output" "ploydok-caddy:test3"
assert_text_contains "$upgrade_data_plane_output" "update $TMP/root/opt/ploydok/docker-compose.yml api/web/agent/adminer/caddy images to test3"
assert_text_contains "$upgrade_data_plane_output" "pull api web agent adminer caddy"
assert_text_contains "$upgrade_data_plane_output" "up -d --no-deps api web agent adminer caddy"

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

assert_contains "$TMP/takeover-root/opt/ploydok/docker-compose.yml" '"80:80"'
assert_contains "$TMP/takeover-root/opt/ploydok/docker-compose.yml" '"443:443"'

PLOYDOK_INSTALL_DRY_RUN=1 \
PLOYDOK_INSTALL_ROOT="$TMP/bootstrap-root" \
bash "$ROOT/installer/install.sh" \
  --mode=bootstrap-http \
  --http-port=18080 \
  --https-port=18443 \
  --public-host=212.47.249.36 \
  --data-dir=/var/lib/ploydok \
  --skip-docker-install \
  --yes \
  --version=test

assert_contains "$TMP/bootstrap-root/opt/ploydok/docker-compose.yml" '"0.0.0.0:18080:80"'
assert_contains "$TMP/bootstrap-root/opt/ploydok/docker-compose.yml" '"127.0.0.1:18443:443"'
assert_contains "$TMP/bootstrap-root/opt/ploydok/Caddyfile" "http://212.47.249.36"
assert_contains "$TMP/bootstrap-root/var/lib/ploydok/.env" "WEB_ORIGIN=http://212.47.249.36:18080"
assert_contains "$TMP/bootstrap-root/var/lib/ploydok/.env" "PLOYDOK_PUBLIC_SCHEME=http"
assert_contains "$TMP/bootstrap-root/var/lib/ploydok/.env" "PLOYDOK_PUBLIC_PORT=18080"
assert_contains "$TMP/bootstrap-root/var/lib/ploydok/.env" "PLOYDOK_DOMAIN_BASE=212-47-249-36.sslip.io"
assert_contains "$TMP/bootstrap-root/var/lib/ploydok/.env" "PLOYDOK_SETUP_TOKEN_REQUIRED=0"
assert_contains "$TMP/bootstrap-root/var/lib/ploydok/.env" "PLOYDOK_COOKIE_SECURE=auto"

set +e
PLOYDOK_INSTALL_DRY_RUN=1 \
PLOYDOK_INSTALL_ROOT="$TMP/abort-root" \
bash "$ROOT/installer/install.sh" --mode=abort --skip-docker-install --yes >/dev/null 2>&1
abort_status=$?
set -e
[[ "$abort_status" -eq 2 ]] || { echo "abort mode returned $abort_status, expected 2" >&2; exit 1; }
assert_not_exists "$TMP/abort-root/opt/ploydok/docker-compose.yml"

echo "installer tests OK"
