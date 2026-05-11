#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# audit-rootless.sh — Audit que le container BuildKit tourne en rootless.
#
# Usage:
#   bash scripts/audit-rootless.sh
#   ./scripts/audit-rootless.sh    (après chmod +x)
#
# Exit codes:
#   0  — tous les checks passent (container conforme rootless)
#   1  — un ou plusieurs checks échouent
#
# Prérequis: make infra-up doit avoir été lancé.
set -euo pipefail

CONTAINER="ploydok-buildkitd"
PASS=0
FAIL=0

# ─── Colors (only if stdout is a terminal) ────────────────────────────────────
if [ -t 1 ]; then
  _GREEN='\033[0;32m'
  _RED='\033[0;31m'
  _BOLD='\033[1m'
  _RESET='\033[0m'
else
  _GREEN=''
  _RED=''
  _BOLD=''
  _RESET=''
fi

_ok()   { echo -e "${_GREEN}[OK]${_RESET}   $*"; ((PASS++)) || true; }
_fail() { echo -e "${_RED}[FAIL]${_RESET} $*"; ((FAIL++)) || true; }

# ─── Header ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${_BOLD}=== BuildKit rootless audit ===${_RESET}"
echo "Container: ${CONTAINER}"
echo "Date:      $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo ""

# ─── Check 1: container running ───────────────────────────────────────────────
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "${CONTAINER}"; then
  _ok "container ${CONTAINER} is running"
else
  _fail "container ${CONTAINER} is not running — run 'make infra-up' first"
  echo ""
  echo "## Audit report"
  echo ""
  echo "| Check | Result |"
  echo "|-------|--------|"
  echo "| container running | FAIL |"
  echo ""
  echo "**Overall: FAIL** — container not running, cannot continue."
  exit 1
fi

# ─── Check 2: User in docker inspect is 1000:1000 (or 1000) ─────────────────
INSPECT_USER=$(docker inspect "${CONTAINER}" --format '{{.Config.User}}' 2>/dev/null)
if [ "${INSPECT_USER}" = "1000:1000" ] || [ "${INSPECT_USER}" = "1000" ]; then
  _ok "docker inspect User = ${INSPECT_USER} (expected 1000 or 1000:1000)"
else
  _fail "docker inspect User = '${INSPECT_USER}' — expected '1000:1000' or '1000'"
fi

# ─── Check 3: exec id -u inside container → 1000 ─────────────────────────────
EXEC_UID=$(docker exec "${CONTAINER}" id -u 2>/dev/null)
if [ "${EXEC_UID}" = "1000" ]; then
  _ok "uid inside container (docker exec id -u) = ${EXEC_UID}"
else
  _fail "uid inside container = '${EXEC_UID}' — expected '1000'"
fi

# ─── Check 4: no root process via docker top ─────────────────────────────────
# docker top -o pid,user,cmd — format portable (Linux procps)
ROOT_COUNT=$(docker top "${CONTAINER}" -o pid,user,cmd 2>/dev/null \
  | awk 'NR>1 && $2=="root"' \
  | wc -l)
ROOT_COUNT="${ROOT_COUNT// /}"  # trim whitespace

if [ "${ROOT_COUNT}" = "0" ]; then
  _ok "no root-owned process in container (docker top -o pid,user,cmd | awk root count = 0)"
else
  _fail "root-owned process(es) detected in container (count = ${ROOT_COUNT}):"
  docker top "${CONTAINER}" -o pid,user,cmd 2>/dev/null | awk 'NR==1 || $2=="root"'
fi

# ─── Check 5: container is NOT privileged ────────────────────────────────────
PRIVILEGED=$(docker inspect "${CONTAINER}" --format '{{.HostConfig.Privileged}}' 2>/dev/null)
if [ "${PRIVILEGED}" = "false" ]; then
  _ok "container is NOT privileged (HostConfig.Privileged=false)"
else
  _fail "container is running with privileged=true — not acceptable for rootless"
fi

# ─── Check 6: image tag contains 'rootless' ──────────────────────────────────
IMAGE=$(docker inspect "${CONTAINER}" --format '{{.Config.Image}}' 2>/dev/null)
if echo "${IMAGE}" | grep -q "rootless"; then
  _ok "image tag contains 'rootless': ${IMAGE}"
else
  _fail "image '${IMAGE}' does not contain 'rootless' — update docker-compose.yml"
fi

# ─── Markdown report ─────────────────────────────────────────────────────────
echo ""
echo "## Audit report — ${CONTAINER}"
echo ""
echo "| Check | Expected | Actual | Result |"
echo "|-------|----------|--------|--------|"

# Rebuild rows (re-inspect without failing)
_INSPECT_USER=$(docker inspect "${CONTAINER}" --format '{{.Config.User}}' 2>/dev/null || echo "N/A")
_EXEC_UID=$(docker exec "${CONTAINER}" id -u 2>/dev/null || echo "N/A")
_ROOT_COUNT_RAW=$(docker top "${CONTAINER}" -o pid,user,cmd 2>/dev/null \
  | awk 'NR>1 && $2=="root"' | wc -l)
_ROOT_COUNT_RAW="${_ROOT_COUNT_RAW// /}"
_PRIV=$(docker inspect "${CONTAINER}" --format '{{.HostConfig.Privileged}}' 2>/dev/null || echo "N/A")
_IMAGE=$(docker inspect "${CONTAINER}" --format '{{.Config.Image}}' 2>/dev/null || echo "N/A")

_r() {
  local ok="$1" fail="$2" actual="$3" expected="$4"
  if [ "${ok}" = "1" ]; then echo "| ${fail} | \`${expected}\` | \`${actual}\` | **OK** |"
  else                       echo "| ${fail} | \`${expected}\` | \`${actual}\` | **FAIL** |"
  fi
}

# row helpers: label, expected, actual, pass?
echo "| container running | yes | yes | **OK** |"
[ "${_INSPECT_USER}" = "1000:1000" ] || [ "${_INSPECT_USER}" = "1000" ] \
  && _OK2=1 || _OK2=0
echo "| docker inspect User | \`1000:1000\` | \`${_INSPECT_USER}\` | $( [ "${_OK2}" = 1 ] && echo '**OK**' || echo '**FAIL**') |"
[ "${_EXEC_UID}" = "1000" ] && _OK3=1 || _OK3=0
echo "| exec id -u | \`1000\` | \`${_EXEC_UID}\` | $( [ "${_OK3}" = 1 ] && echo '**OK**' || echo '**FAIL**') |"
[ "${_ROOT_COUNT_RAW}" = "0" ] && _OK4=1 || _OK4=0
echo "| root procs (docker top) | \`0\` | \`${_ROOT_COUNT_RAW}\` | $( [ "${_OK4}" = 1 ] && echo '**OK**' || echo '**FAIL**') |"
[ "${_PRIV}" = "false" ] && _OK5=1 || _OK5=0
echo "| privileged | \`false\` | \`${_PRIV}\` | $( [ "${_OK5}" = 1 ] && echo '**OK**' || echo '**FAIL**') |"
echo "${_IMAGE}" | grep -q "rootless" && _OK6=1 || _OK6=0
echo "| image rootless tag | contains \`rootless\` | \`${_IMAGE}\` | $( [ "${_OK6}" = 1 ] && echo '**OK**' || echo '**FAIL**') |"

echo ""

# ─── Final summary ────────────────────────────────────────────────────────────
echo -e "${_BOLD}=== Summary: ${PASS} passed, ${FAIL} failed ===${_RESET}"
if [ "${FAIL}" -gt 0 ]; then
  echo ""
  echo "**Overall: FAIL** — ${FAIL} check(s) failed. Check the BuildKit rootless setup and host Docker configuration."
  exit 1
fi
echo "All checks passed — BuildKit is running rootless."
exit 0
