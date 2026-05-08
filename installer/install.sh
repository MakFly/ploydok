#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -Eeuo pipefail

VERSION="0.0.1"
MODE=""
HTTP_PORT="8080"
HTTPS_PORT="8443"
DATA_DIR="/var/lib/ploydok"
IMAGE_REGISTRY="${PLOYDOK_IMAGE_REGISTRY:-ghcr.io/ploydok}"
SKIP_DOCKER_INSTALL=0
MANAGE_FIREWALL=0
YES=0
UNATTENDED=0
DRY_RUN="${PLOYDOK_INSTALL_DRY_RUN:-0}"
ROOT_PREFIX="${PLOYDOK_INSTALL_ROOT:-}"
LOG_DIR="/var/log/ploydok-install"
BACKUP_DIR="/var/backups/ploydok-install"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PREFLIGHT_LOG=""

usage() {
  cat <<'USAGE'
Usage: install.sh [options]

Options:
  --mode=takeover|coexist|abort
  --http-port=8080
  --https-port=8443
  --data-dir=/var/lib/ploydok
  --skip-docker-install
  --manage-firewall
  --yes
  --unattended
  --version=<tag>
  --image-registry=<registry>
  --help

Environment for tests:
  PLOYDOK_INSTALL_DRY_RUN=1
  PLOYDOK_INSTALL_ROOT=/tmp/root
  PLOYDOK_INSTALL_SKIP_COSIGN=1
USAGE
}

for arg in "$@"; do
  case "$arg" in
    --mode=*) MODE="${arg#*=}" ;;
    --http-port=*) HTTP_PORT="${arg#*=}" ;;
    --https-port=*) HTTPS_PORT="${arg#*=}" ;;
    --data-dir=*) DATA_DIR="${arg#*=}" ;;
    --skip-docker-install) SKIP_DOCKER_INSTALL=1 ;;
    --manage-firewall) MANAGE_FIREWALL=1 ;;
    --yes) YES=1 ;;
    --unattended) UNATTENDED=1; YES=1; MODE="coexist" ;;
    --version=*) VERSION="${arg#*=}" ;;
    --image-registry=*) IMAGE_REGISTRY="${arg#*=}" ;;
    --help) usage; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; usage >&2; exit 1 ;;
  esac
done

case "$MODE" in
  ""|takeover|coexist|abort) ;;
  *) echo "Invalid --mode: $MODE" >&2; exit 1 ;;
esac

real_path() {
  local p="$1"
  if [[ -n "$ROOT_PREFIX" ]]; then
    printf '%s%s\n' "$ROOT_PREFIX" "$p"
  else
    printf '%s\n' "$p"
  fi
}

install_dir() {
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd
}

log() { printf '[ploydok-install] %s\n' "$*"; }
warn() { printf '[ploydok-install] WARN: %s\n' "$*" >&2; }
die() { printf '[ploydok-install] ERROR: %s\n' "$*" >&2; exit "${2:-1}"; }

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    log "dry-run: $*"
  else
    "$@"
  fi
}

write_file() {
  local target="$1"
  local mode="$2"
  local owner="${3:-}"
  local tmp
  tmp="$(mktemp)"
  cat >"$tmp"
  install -D -m "$mode" "$tmp" "$(real_path "$target")"
  rm -f "$tmp"
  if [[ -n "$owner" && "$DRY_RUN" != "1" && -z "$ROOT_PREFIX" ]]; then
    chown "$owner" "$target"
  fi
}

render_template() {
  local template="$1"
  PLOYDOK_VERSION="$VERSION" \
  PLOYDOK_IMAGE_REGISTRY="$IMAGE_REGISTRY" \
  PLOYDOK_DATA_DIR="$DATA_DIR" \
  PLOYDOK_HTTP_PORT="$HTTP_PORT" \
  PLOYDOK_HTTPS_PORT="$HTTPS_PORT" \
  PLOYDOK_HTTP_BIND="$HTTP_BIND" \
  PLOYDOK_HTTPS_BIND="$HTTPS_BIND" \
  envsubst '$PLOYDOK_VERSION $PLOYDOK_IMAGE_REGISTRY $PLOYDOK_DATA_DIR $PLOYDOK_HTTP_PORT $PLOYDOK_HTTPS_PORT $PLOYDOK_HTTP_BIND $PLOYDOK_HTTPS_BIND' <"$(install_dir)/templates/$template"
}

require_root() {
  if [[ "$DRY_RUN" == "1" || -n "$ROOT_PREFIX" ]]; then return; fi
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    die "installer must run as root" 1
  fi
}

version_ge() {
  local have="$1" need="$2"
  [[ "$(printf '%s\n%s\n' "$need" "$have" | sort -V | head -n1)" == "$need" ]]
}

kernel_version() { uname -r | sed 's/[^0-9.].*$//'; }
total_mem_mb() { awk '/MemTotal:/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0; }
free_disk_mb() { df -Pm / | awk 'NR==2 {print $4}' 2>/dev/null || echo 0; }
docker_major() { docker version --format '{{.Server.Version}}' 2>/dev/null | cut -d. -f1 || true; }

read_env_value() {
  local file="$1" key="$2"
  grep -E "^${key}=" "$file" 2>/dev/null | tail -n1 | cut -d= -f2- || true
}

list_port_listeners() {
  if command -v ss >/dev/null 2>&1; then
    ss -tlnp 2>/dev/null | awk '$4 ~ /:(80|443)$/ {print}'
  else
    true
  fi
}

active_proxy_services() {
  local svc
  for svc in nginx apache2 caddy traefik haproxy; do
    if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet "$svc"; then
      echo "$svc"
    fi
  done
}

preflight() {
  mkdir -p "$(real_path "$LOG_DIR")"
  PREFLIGHT_LOG="$(real_path "$LOG_DIR/preflight-$TIMESTAMP.log")"
  {
    echo "timestamp=$TIMESTAMP"
    echo "kernel=$(uname -r)"
    echo "arch=$(uname -m)"
    echo "mode=${MODE:-interactive}"
    echo "data_dir=$DATA_DIR"
    echo "port_listeners_start"
    list_port_listeners || true
    echo "port_listeners_end"
    echo "active_proxy_services=$(active_proxy_services | paste -sd, -)"
    echo "docker_containers=$(docker ps -a --filter 'name=ploydok-*' --format '{{.Names}}' 2>/dev/null | paste -sd, -)"
    echo "firewall=$(command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | head -n1 || true)"
    echo "selinux=$(command -v getenforce >/dev/null 2>&1 && getenforce || true)"
    echo "apparmor=$(cat /sys/module/apparmor/parameters/enabled 2>/dev/null || true)"
    echo "timezone=$(timedatectl show -p Timezone --value 2>/dev/null || true)"
    echo "ntp=$(timedatectl show -p NTPSynchronized --value 2>/dev/null || true)"
  } >"$PREFLIGHT_LOG"

  version_ge "$(kernel_version)" "5.10" || die "Linux kernel >= 5.10 required" 3
  case "$(uname -m)" in x86_64|aarch64|arm64) ;; *) die "unsupported architecture: $(uname -m)" 3 ;; esac
  command -v systemctl >/dev/null 2>&1 || die "systemd is required" 3
  command -v openssl >/dev/null 2>&1 || die "openssl is required" 3
  command -v envsubst >/dev/null 2>&1 || die "envsubst is required (install gettext-base)" 3
  command -v curl >/dev/null 2>&1 || die "curl is required" 3
  [[ -d /run/systemd/system || "$DRY_RUN" == "1" || -n "$ROOT_PREFIX" ]] || die "systemd is not running" 3

  if [[ -r /proc/sys/kernel/unprivileged_userns_clone ]]; then
    [[ "$(cat /proc/sys/kernel/unprivileged_userns_clone)" == "1" ]] || die "unprivileged user namespaces must be enabled" 3
  fi

  if ! command -v docker >/dev/null 2>&1; then
    if [[ "$SKIP_DOCKER_INSTALL" == "1" ]]; then
      die "Docker is missing and --skip-docker-install was set" 3
    fi
    install_docker
  fi
  local major
  major="$(docker_major)"
  [[ -n "$major" && "$major" -ge 24 ]] || die "Docker server >= 24 is required" 3

  [[ "$(total_mem_mb)" -ge 2048 ]] || die "at least 2 GB RAM is required" 3
  [[ "$(free_disk_mb)" -ge 10240 ]] || die "at least 10 GB free disk is required" 3
  [[ "$(total_mem_mb)" -ge 4096 ]] || warn "less than 4 GB RAM available"
  [[ "$(free_disk_mb)" -ge 20480 ]] || warn "less than 20 GB free disk available"

  log "preflight report: $PREFLIGHT_LOG"
}

has_port_conflict() {
  [[ -n "$(list_port_listeners)" ]]
}

choose_mode() {
  if [[ "$MODE" == "abort" ]]; then
    log "mode=abort requested; no changes will be made"
    exit 2
  fi
  if [[ -n "$MODE" ]]; then return; fi
  if ! has_port_conflict; then
    MODE="takeover"
    return
  fi
  if [[ "$YES" == "1" ]]; then
    die "ports 80/443 are occupied and no --mode was provided" 4
  fi
  echo "Ports 80/443 are occupied. Choose: [T]akeover, [C]oexist, [A]bort" >&2
  read -r answer
  case "${answer,,}" in
    t|takeover) MODE="takeover" ;;
    c|coexist) MODE="coexist" ;;
    *) exit 2 ;;
  esac
}

configure_binds() {
  if [[ "$MODE" == "coexist" ]]; then
    HTTP_BIND="127.0.0.1:${HTTP_PORT}"
    HTTPS_BIND="127.0.0.1:${HTTPS_PORT}"
  else
    HTTP_BIND="80"
    HTTPS_BIND="443"
  fi
}

backup_proxy_configs() {
  mkdir -p "$(real_path "$BACKUP_DIR")"
  local svc
  for svc in nginx apache2 caddy traefik haproxy; do
    local src="/etc/$svc"
    if [[ -d "$src" ]]; then
      run tar -czf "$(real_path "$BACKUP_DIR/$svc-$TIMESTAMP.tar.gz")" -C "$(dirname "$src")" "$(basename "$src")"
    fi
  done
}

takeover_proxy() {
  [[ "$MODE" == "takeover" ]] || return 0
  backup_proxy_configs
  local svc
  for svc in $(active_proxy_services); do
    run systemctl stop "$svc"
    run systemctl disable "$svc"
  done
}

create_system_user() {
  if id ploydok >/dev/null 2>&1; then return; fi
  run useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin ploydok
}

create_directories() {
  local dir
  for dir in data builds backups volumes app-volumes certs logs caddy/data caddy/config postgres redis registry agent config static; do
    install -d -m 0750 "$(real_path "$DATA_DIR/$dir")"
  done
  if [[ "$DRY_RUN" != "1" && -z "$ROOT_PREFIX" ]]; then
    chown -R ploydok:ploydok "$DATA_DIR"
  fi
}

generate_secrets() {
  local master_key pg_pass redis_pass session_secret
  local master_path env_path
  master_path="$(real_path "$DATA_DIR/master.key")"
  env_path="$(real_path "$DATA_DIR/.env")"

  if [[ -f "$env_path" ]]; then
    master_key="$(read_env_value "$env_path" MASTER_KEY)"
    if [[ -n "$master_key" && ! -f "$master_path" ]]; then
      write_file "$DATA_DIR/master.key" 0400 ploydok:ploydok <<<"$master_key"
    fi
    log "existing $DATA_DIR/.env preserved"
    return
  fi

  if [[ -f "$master_path" ]]; then
    master_key="$(cat "$master_path")"
  else
    master_key="$(openssl rand -base64 32)"
    write_file "$DATA_DIR/master.key" 0400 ploydok:ploydok <<<"$master_key"
  fi

  pg_pass="$(openssl rand -hex 32)"
  redis_pass="$(openssl rand -hex 32)"
  session_secret="$(openssl rand -hex 32)"
  write_file "$DATA_DIR/.env" 0600 ploydok:ploydok <<EOF
NODE_ENV=prod
PORT=3335
DATABASE_URL=postgres://ploydok:${pg_pass}@postgres:5432/ploydok
REDIS_URL=redis://:${redis_pass}@redis:6379/0
PLOYDOK_PG_PASSWORD=${pg_pass}
PLOYDOK_REDIS_PASSWORD=${redis_pass}
SESSION_SECRET=${session_secret}
MASTER_KEY=${master_key}
PLOYDOK_PUBLIC_SCHEME=https
PLOYDOK_PUBLIC_HOST=${PLOYDOK_PUBLIC_HOST:-localhost}
PLOYDOK_REGISTRY_URL=registry:5000
PLOYDOK_REGISTRY_PUSH_URL=registry:5000
EOF
}

generate_mtls() {
  local cert_dir
  cert_dir="$(real_path "$DATA_DIR/certs")"
  if [[ "$DRY_RUN" == "1" ]]; then
    log "dry-run: generate mTLS certs in $cert_dir"
    return
  fi
  openssl req -x509 -newkey rsa:4096 -nodes -days 3650 \
    -keyout "$cert_dir/ca.key" -out "$cert_dir/ca.crt" \
    -subj "/CN=Ploydok local CA" >/dev/null 2>&1
  openssl req -newkey rsa:4096 -nodes \
    -keyout "$cert_dir/agent.key" -out "$cert_dir/agent.csr" \
    -subj "/CN=ploydok-agent" >/dev/null 2>&1
  openssl x509 -req -in "$cert_dir/agent.csr" -CA "$cert_dir/ca.crt" \
    -CAkey "$cert_dir/ca.key" -CAcreateserial -out "$cert_dir/agent.crt" \
    -days 3650 >/dev/null 2>&1
}

install_docker() {
  log "Docker not found; installing via get.docker.com (skip with --skip-docker-install)"
  if [[ "$DRY_RUN" == "1" ]]; then
    log "dry-run: curl -fsSL https://get.docker.com | sh"
    return
  fi
  curl -fsSL https://get.docker.com | sh >/dev/null
  systemctl enable --now docker >/dev/null 2>&1 || true
  command -v docker >/dev/null 2>&1 || die "Docker installation failed" 3
}

install_cli() {
  local src
  src="$(install_dir)/ploydok-cli"
  if [[ -f "$src" ]]; then
    install -D -m 0755 "$src" "$(real_path /usr/local/bin/ploydok-cli)"
  fi
}

verify_or_pull_images() {
  local images=(
    "$IMAGE_REGISTRY/ploydok-api:$VERSION"
    "$IMAGE_REGISTRY/ploydok-agent:$VERSION"
    "$IMAGE_REGISTRY/ploydok-caddy:$VERSION"
  )
  local image
  for image in "${images[@]}"; do
    if command -v cosign >/dev/null 2>&1; then
      run cosign verify "$image"
    elif [[ "$DRY_RUN" == "1" || "${PLOYDOK_INSTALL_SKIP_COSIGN:-0}" == "1" ]]; then
      warn "cosign not installed; image signature verification skipped for $image"
    else
      die "cosign is required to verify $image (set PLOYDOK_INSTALL_SKIP_COSIGN=1 only for controlled test installs)" 3
    fi
    run docker pull "$image"
  done
}

write_templates() {
  render_template docker-compose.yml | write_file "$DATA_DIR/docker-compose.yml" 0640 ploydok:ploydok
  render_template validator.toml | write_file "$DATA_DIR/config/validator.toml" 0640 ploydok:ploydok
  render_template ploydok.service | write_file "/etc/systemd/system/ploydok.service" 0644
  render_template ploydok.target | write_file "/etc/systemd/system/ploydok.target" 0644
  if [[ "$MODE" == "coexist" ]]; then
    render_template nginx-ploydok.conf | write_file "/etc/nginx/snippets/ploydok.conf" 0644
    render_template apache-ploydok.conf | write_file "/etc/apache2/conf-available/ploydok.conf" 0644
  fi
}

configure_firewall() {
  [[ "$MANAGE_FIREWALL" == "1" ]] || return 0
  if command -v ufw >/dev/null 2>&1; then
    run ufw allow 22/tcp
    if [[ "$MODE" == "coexist" ]]; then
      warn "coexist mode keeps Ploydok bound to loopback; not opening $HTTP_PORT/$HTTPS_PORT publicly"
    else
      run ufw allow 80/tcp
      run ufw allow 443/tcp
    fi
    run ufw deny 2019 || true
    run ufw deny 5000 || true
  elif command -v firewall-cmd >/dev/null 2>&1; then
    if [[ "$MODE" == "coexist" ]]; then
      warn "coexist mode keeps Ploydok bound to loopback; not opening $HTTP_PORT/$HTTPS_PORT publicly"
    else
      run firewall-cmd --permanent --add-service=http
      run firewall-cmd --permanent --add-service=https
    fi
    run firewall-cmd --reload
  else
    warn "no supported firewall manager detected; wrote docs only"
  fi
}

start_services() {
  run systemctl daemon-reload
  run systemctl enable --now ploydok.target
}

wait_health() {
  [[ "$DRY_RUN" == "1" ]] && return
  local url="http://127.0.0.1:3335/health"
  for _ in $(seq 1 60); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      log "healthcheck OK"
      return
    fi
    sleep 1
  done
  die "healthcheck timed out: $url" 1
}

db_migrate() {
  [[ "$DRY_RUN" == "1" ]] && { log "dry-run: applying db migrations"; return; }
  local compose=(docker compose --env-file "$DATA_DIR/.env" -f "$DATA_DIR/docker-compose.yml")
  log "waiting for postgres to accept connections"
  for _ in $(seq 1 60); do
    if "${compose[@]}" exec -T postgres pg_isready -U ploydok -d ploydok >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  log "applying database migrations"
  "${compose[@]}" exec -T api bun run /app/packages/db/src/migrate.ts
  log "restarting api after migrations"
  "${compose[@]}" restart api >/dev/null
}

main() {
  require_root
  preflight
  choose_mode
  configure_binds
  log "installing Ploydok $VERSION in mode=$MODE data_dir=$DATA_DIR"
  takeover_proxy
  create_system_user
  create_directories
  generate_secrets
  generate_mtls
  verify_or_pull_images
  write_templates
  configure_firewall
  install_cli
  start_services
  wait_health
  db_migrate
  log "Ploydok installed. Open https://${PLOYDOK_PUBLIC_HOST:-localhost}/setup from this machine's DNS."
}

main "$@"
