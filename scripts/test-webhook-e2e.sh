#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# Webhook auto-deploy end-to-end test.
#
# Pushes a no-op commit to a target GitHub repo that is already wired to a
# Ploydok app via the installed GitHub App, then polls the API until a new
# build reaches the "succeeded" state and the app domain responds 200.
#
# Required env:
#   APP_ID       app uuid in Ploydok (export APP_ID=<uuid>)
#   AUTH_COOKIE  value of the ploydok_access cookie (export AUTH_COOKIE="...")
# Optional env:
#   REPO         default: MakFly/ploydok-hello
#   BRANCH       default: main
#   API          default: http://localhost:4000
#   TIMEOUT_S    default: 180
#
# Exit 0 on success, non-zero on timeout or transport error.

set -euo pipefail

REPO="${REPO:-MakFly/ploydok-hello}"
BRANCH="${BRANCH:-main}"
API="${API:-http://localhost:4000}"
TIMEOUT_S="${TIMEOUT_S:-180}"

: "${APP_ID:?APP_ID required — export APP_ID=<uuid from DB>}"
: "${AUTH_COOKIE:?AUTH_COOKIE required — export AUTH_COOKIE=<value of ploydok_access>}"

COOKIE_HEADER="Cookie: ploydok_access=${AUTH_COOKIE}"

fetch_latest_build() {
  curl -fsS -H "$COOKIE_HEADER" "$API/apps/$APP_ID/builds" \
    | jq -r '.builds[0] // {}'
}

fetch_app_domain() {
  curl -fsS -H "$COOKIE_HEADER" "$API/apps/$APP_ID" \
    | jq -r '.app.domain // empty'
}

echo "== baseline =="
BEFORE_JSON=$(fetch_latest_build)
BEFORE_ID=$(echo "$BEFORE_JSON" | jq -r '.id // "none"')
echo "latest build before push: $BEFORE_ID"

echo "== pushing no-op commit to $REPO ($BRANCH) =="
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
(
  cd "$tmp"
  gh repo clone "$REPO" . -- --depth=1 --branch "$BRANCH" >/dev/null
  date -Iseconds > .ploydok-trigger
  git add .ploydok-trigger
  git commit -s -m "chore(webhook-e2e): trigger $(date -Iseconds)" >/dev/null
  git push origin "$BRANCH" >/dev/null
)

echo "== polling for new build + HTTP 200 =="
deadline=$(( $(date +%s) + TIMEOUT_S ))
domain=""
while [ "$(date +%s)" -lt "$deadline" ]; do
  LATEST=$(fetch_latest_build)
  ID=$(echo "$LATEST" | jq -r '.id // "none"')
  STATUS=$(echo "$LATEST" | jq -r '.status // "pending"')

  if [ "$ID" != "$BEFORE_ID" ] && [ "$STATUS" = "succeeded" ]; then
    echo "new build succeeded: $ID"
    domain=$(fetch_app_domain)
    if [ -z "$domain" ]; then
      echo "app has no domain set — cannot verify HTTP 200"
      exit 2
    fi
    CODE=$(curl -sk -o /dev/null -w "%{http_code}" "https://$domain" || echo "000")
    if [ "$CODE" = "200" ]; then
      echo "OK: https://$domain → 200"
      exit 0
    fi
    echo "domain reachable but status=$CODE (will retry)"
  fi
  sleep 3
done

echo "TIMEOUT after ${TIMEOUT_S}s — last build id=$ID status=$STATUS domain=${domain:-unset}"
exit 1
