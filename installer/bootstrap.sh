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

log() { printf '[ploydok-bootstrap] %s\n' "$*"; }
die() { printf '[ploydok-bootstrap] ERROR: %s\n' "$*" >&2; exit "${2:-1}"; }

if [[ "$DRY_RUN" != "1" && "${EUID:-$(id -u)}" -ne 0 ]]; then
  die "must run as root (use sudo)" 1
fi

for bin in curl git bash; do
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
