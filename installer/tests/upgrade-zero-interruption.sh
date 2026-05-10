#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
PROJECT="ploydok-upgrade-zero-$$"
PROBE_PID=""

find_free_port() {
  local start="$1"
  local end="$2"
  local port
  for port in $(seq "$start" "$end"); do
    if ! (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1; then
      echo "$port"
      return 0
    fi
  done
  echo "no free port in ${start}-${end}" >&2
  return 1
}

cleanup() {
  set +e
  if [[ -n "$PROBE_PID" ]]; then
    touch "$TMP/probe-stop" 2>/dev/null
    wait "$PROBE_PID" 2>/dev/null
  fi
  if [[ -f "$TMP/data/docker-compose.yml" ]]; then
    docker compose --env-file "$TMP/data/.env" -f "$TMP/data/docker-compose.yml" -p "$PROJECT" down -v --remove-orphans >/dev/null 2>&1
  fi
  docker rmi \
    local/ploydok-api:test-a \
    local/ploydok-api:test-b \
    local/ploydok-web:test-a \
    local/ploydok-web:test-b \
    local/ploydok-agent:test-a \
    local/ploydok-agent:test-b \
    local/ploydok-adminer:test-a \
    local/ploydok-adminer:test-b \
    local/ploydok-caddy:test-a >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 2; }

APP_PORT="$(find_free_port 19080 19180)"
API_PORT="$(find_free_port 19181 19280)"
CADDY_ADMIN_PORT="$(find_free_port 19281 19380)"

mkdir -p "$TMP/api" "$TMP/agent" "$TMP/caddy" "$TMP/data/backups"

cat >"$TMP/api/default.conf" <<'EOF'
server {
  listen 3335;
  server_name _;
  location /health/ready {
    default_type application/json;
    return 200 '{"ok":true}';
  }
  location / {
    return 200 'api';
  }
}
EOF

cat >"$TMP/api/Dockerfile" <<'EOF'
FROM nginx:1.27-alpine
COPY default.conf /etc/nginx/conf.d/default.conf
EOF

cat >"$TMP/agent/Dockerfile" <<'EOF'
FROM busybox:1.36
CMD ["sh", "-c", "trap 'exit 0' TERM INT; while true; do sleep 3600; done"]
EOF

cat >"$TMP/caddy/Caddyfile" <<'EOF'
{
  admin :2019
  auto_https off
}

:80 {
  reverse_proxy app:80
}
EOF

cat >"$TMP/caddy/Dockerfile" <<'EOF'
FROM caddy:2.11-alpine
COPY Caddyfile /etc/caddy/Caddyfile
EOF

docker build -q -t local/ploydok-api:test-a "$TMP/api" >/dev/null
docker build -q -t local/ploydok-api:test-b "$TMP/api" >/dev/null
docker build -q -t local/ploydok-web:test-a "$TMP/api" >/dev/null
docker build -q -t local/ploydok-web:test-b "$TMP/api" >/dev/null
docker build -q -t local/ploydok-agent:test-a "$TMP/agent" >/dev/null
docker build -q -t local/ploydok-agent:test-b "$TMP/agent" >/dev/null
docker build -q -t local/ploydok-adminer:test-a "$TMP/api" >/dev/null
docker build -q -t local/ploydok-adminer:test-b "$TMP/api" >/dev/null
docker build -q -t local/ploydok-caddy:test-a "$TMP/caddy" >/dev/null

cat >"$TMP/data/.env" <<EOF
PLOYDOK_IMAGE_REGISTRY=local
PLOYDOK_VERSION=test-a
EOF

cat >"$TMP/data/docker-compose.yml" <<EOF
name: ${PROJECT}

services:
  api:
    image: local/ploydok-api:test-a
    ports:
      - "127.0.0.1:${API_PORT}:3335"
  web:
    image: local/ploydok-web:test-a
  agent:
    image: local/ploydok-agent:test-a
  adminer:
    image: local/ploydok-adminer:test-a
  caddy:
    image: local/ploydok-caddy:test-a
    ports:
      - "127.0.0.1:${APP_PORT}:80"
      - "127.0.0.1:${CADDY_ADMIN_PORT}:2019"
    depends_on:
      - app
  app:
    image: nginx:1.27-alpine
EOF

docker compose --env-file "$TMP/data/.env" -f "$TMP/data/docker-compose.yml" -p "$PROJECT" up -d >/dev/null

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1 &&
    curl -fsS "http://127.0.0.1:${API_PORT}/health/ready" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -fsS "http://127.0.0.1:${APP_PORT}/" >/dev/null
curl -fsS "http://127.0.0.1:${API_PORT}/health/ready" >/dev/null

caddy_before="$(docker compose --env-file "$TMP/data/.env" -f "$TMP/data/docker-compose.yml" -p "$PROJECT" ps -q caddy)"
app_before="$(docker compose --env-file "$TMP/data/.env" -f "$TMP/data/docker-compose.yml" -p "$PROJECT" ps -q app)"

probe_errors="$TMP/probe-errors.log"
probe_stop="$TMP/probe-stop"
touch "$probe_errors"
(
  while [[ ! -f "$probe_stop" ]]; do
    code="$(curl -sS -m 1 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${APP_PORT}/" 2>/dev/null || echo "000")"
    case "$code" in
      2*) ;;
      *) printf '%s\n' "$code" >>"$probe_errors" ;;
    esac
    sleep 0.1
  done
) &
PROBE_PID="$!"

PLOYDOK_INSTALL_SKIP_COSIGN=1 \
PLOYDOK_SKIP_PULL=1 \
PLOYDOK_SKIP_DB_SNAPSHOT=1 \
PLOYDOK_HEALTH_URL="http://127.0.0.1:${API_PORT}/health/ready" \
  bash "$ROOT/installer/ploydok-cli" upgrade \
    --data-dir="$TMP/data" \
    --version=test-b \
    --skip-migrations

touch "$probe_stop"
wait "$PROBE_PID"
PROBE_PID=""

caddy_after="$(docker compose --env-file "$TMP/data/.env" -f "$TMP/data/docker-compose.yml" -p "$PROJECT" ps -q caddy)"
app_after="$(docker compose --env-file "$TMP/data/.env" -f "$TMP/data/docker-compose.yml" -p "$PROJECT" ps -q app)"

[[ "$caddy_before" == "$caddy_after" ]] || {
  echo "caddy container was recreated during control-plane upgrade" >&2
  exit 1
}
[[ "$app_before" == "$app_after" ]] || {
  echo "app container was recreated during control-plane upgrade" >&2
  exit 1
}
[[ ! -s "$probe_errors" ]] || {
  echo "traffic probe saw errors during upgrade:" >&2
  cat "$probe_errors" >&2
  exit 1
}

echo "upgrade zero-interruption test OK"
