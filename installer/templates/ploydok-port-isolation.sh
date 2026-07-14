#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -Eeuo pipefail

MODE="${PLOYDOK_MODE}"
HTTP_PORT="${PLOYDOK_HTTP_PUBLISHED_PORT}"
HTTPS_PORT="${PLOYDOK_HTTPS_PUBLISHED_PORT}"
ACTION="${1:-start}"
COMMENT="ploydok-loopback-only"

ports=(5000)
case "$MODE" in
  coexist) ports+=("$HTTP_PORT" "$HTTPS_PORT") ;;
  bootstrap-http) ports+=("$HTTPS_PORT") ;;
esac

apply_rules() {
  local bin="$1" loopback="$2" port
  command -v "$bin" >/dev/null 2>&1 || return 0
  "$bin" -N DOCKER-USER 2>/dev/null || true
  for port in "${ports[@]}"; do
    local rule=(
      -p tcp -m conntrack --ctorigdstport "$port"
      ! -s "$loopback"
      -m comment --comment "$COMMENT-$port"
      -j REJECT
    )
    if [[ "$ACTION" == "start" ]]; then
      "$bin" -C DOCKER-USER "${rule[@]}" 2>/dev/null ||
        "$bin" -I DOCKER-USER 1 "${rule[@]}"
    else
      while "$bin" -C DOCKER-USER "${rule[@]}" 2>/dev/null; do
        "$bin" -D DOCKER-USER "${rule[@]}"
      done
    fi
  done
}

apply_input_rules() {
  local bin="$1" loopback="$2" port
  command -v "$bin" >/dev/null 2>&1 || return 0
  for port in "${ports[@]}"; do
    local rule=(
      -p tcp --dport "$port"
      ! -s "$loopback"
      -m comment --comment "$COMMENT-input-$port"
      -j REJECT
    )
    if [[ "$ACTION" == "start" ]]; then
      "$bin" -C INPUT "${rule[@]}" 2>/dev/null ||
        "$bin" -I INPUT 1 "${rule[@]}"
    else
      while "$bin" -C INPUT "${rule[@]}" 2>/dev/null; do
        "$bin" -D INPUT "${rule[@]}"
      done
    fi
  done
}

case "$ACTION" in
  start|stop) ;;
  *) echo "usage: $0 start|stop" >&2; exit 2 ;;
esac

apply_rules iptables 127.0.0.0/8
apply_rules ip6tables ::1/128
apply_input_rules iptables 127.0.0.0/8
apply_input_rules ip6tables ::1/128
