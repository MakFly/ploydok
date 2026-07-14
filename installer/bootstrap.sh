#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# Ploydok one-line installer.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/MakFly/ploydok/main/installer/bootstrap.sh | sudo bash
#   curl -fsSL https://raw.githubusercontent.com/MakFly/ploydok/main/installer/bootstrap.sh | sudo bash -s -- --mode=coexist --yes
#
# Once the install.ploydok.dev domain is live, the alias will be:
#   curl -fsSL https://install.ploydok.dev | sudo bash
#
set -Eeuo pipefail

REPO_URL="${PLOYDOK_REPO_URL:-https://github.com/MakFly/ploydok.git}"
REF="${PLOYDOK_REF:-main}"
WORK_DIR="${PLOYDOK_BOOTSTRAP_DIR:-/opt/ploydok-installer}"
DRY_RUN="${PLOYDOK_INSTALL_DRY_RUN:-0}"
COSIGN_VERSION="${PLOYDOK_COSIGN_VERSION:-v2.4.3}"

log() { printf '[ploydok-bootstrap] %s\n' "$*"; }
die() { printf '[ploydok-bootstrap] ERROR: %s\n' "$*" >&2; exit "${2:-1}"; }

if [[ "$DRY_RUN" != "1" && "${EUID:-$(id -u)}" -ne 0 ]]; then
  die "must run as root (use sudo)" 1
fi

command -v curl >/dev/null 2>&1 || die "curl is required" 3
command -v bash >/dev/null 2>&1 || die "bash is required" 3

install_base_dependencies() {
  command -v git >/dev/null 2>&1 && command -v envsubst >/dev/null 2>&1 && return
  if command -v apt-get >/dev/null 2>&1; then
    log "installing bootstrap dependencies"
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates git gettext-base
    return
  fi
  die "git and envsubst are required (automatic installation supports apt-based hosts)" 3
}

install_cosign() {
  command -v cosign >/dev/null 2>&1 && return
  if [[ "${PLOYDOK_INSTALL_SKIP_COSIGN:-0}" == "1" ]]; then return; fi
  local arch asset tmp
  case "$(uname -m)" in
    x86_64) arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) die "unsupported architecture for cosign: $(uname -m)" 3 ;;
  esac
  asset="cosign-linux-${arch}"
  tmp="$(mktemp -d)"
  (
    trap 'rm -rf "$tmp"' EXIT
    log "installing cosign ${COSIGN_VERSION}"
    curl -fsSL "https://github.com/sigstore/cosign/releases/download/${COSIGN_VERSION}/${asset}" -o "$tmp/$asset"
    curl -fsSL "https://github.com/sigstore/cosign/releases/download/${COSIGN_VERSION}/cosign_checksums.txt" -o "$tmp/cosign_checksums.txt"
    cd "$tmp"
    grep -E "[[:space:]]${asset}$" cosign_checksums.txt | sha256sum -c -
    install -m 0755 "$tmp/$asset" /usr/local/bin/cosign
  )
}

if [[ "$DRY_RUN" != "1" ]]; then
  install_base_dependencies
  install_cosign
fi

for bin in git envsubst; do
  command -v "$bin" >/dev/null 2>&1 || die "$bin is required" 3
done

log "fetching $REPO_URL@$REF into $WORK_DIR"
if [[ -d "$WORK_DIR/.git" ]]; then
  git -C "$WORK_DIR" fetch --depth 1 origin "$REF"
  git -C "$WORK_DIR" checkout -q FETCH_HEAD
else
  rm -rf "$WORK_DIR"
  git clone --depth 1 --branch "$REF" "$REPO_URL" "$WORK_DIR"
fi

log "running installer (forwarding $# args)"
exec bash "$WORK_DIR/installer/install.sh" "$@"
