#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

SOURCE="$TMP/source"
mkdir -p "$SOURCE/installer"
git -C "$SOURCE" init -q
git -C "$SOURCE" config user.email test@ploydok.local
git -C "$SOURCE" config user.name "Ploydok test"
printf '#!/usr/bin/env bash\nprintf "verified installer: %%s\\n" "${PLOYDOK_VERSION:-missing}"\n' \
  >"$SOURCE/installer/install.sh"
chmod +x "$SOURCE/installer/install.sh"
git -C "$SOURCE" add installer/install.sh
git -C "$SOURCE" commit -qm "test fixture"
COMMIT="$(git -C "$SOURCE" rev-parse HEAD)"

output="$(
  PLOYDOK_INSTALL_DRY_RUN=1 \
  PLOYDOK_INSTALL_SKIP_COSIGN=1 \
  PLOYDOK_REPO_URL="$SOURCE" \
  PLOYDOK_REF="$COMMIT" \
  PLOYDOK_EXPECTED_COMMIT="$COMMIT" \
  PLOYDOK_VERSION="test" \
  PLOYDOK_BOOTSTRAP_DIR="$TMP/checkout" \
  bash "$ROOT/installer/bootstrap.sh"
)"
grep -Fq "verified source commit $COMMIT" <<<"$output"
grep -Fq "verified installer: test" <<<"$output"

set +e
PLOYDOK_INSTALL_DRY_RUN=1 \
PLOYDOK_INSTALL_SKIP_COSIGN=1 \
PLOYDOK_REPO_URL="$SOURCE" \
PLOYDOK_REF="$COMMIT" \
PLOYDOK_EXPECTED_COMMIT="0000000000000000000000000000000000000000" \
PLOYDOK_VERSION="test" \
PLOYDOK_BOOTSTRAP_DIR="$TMP/tampered" \
bash "$ROOT/installer/bootstrap.sh" >/dev/null 2>&1
tampered_status=$?

PLOYDOK_INSTALL_DRY_RUN=1 \
PLOYDOK_INSTALL_SKIP_COSIGN=1 \
PLOYDOK_REPO_URL="$SOURCE" \
PLOYDOK_BOOTSTRAP_DIR="$TMP/unpinned" \
bash "$ROOT/installer/bootstrap.sh" >/dev/null 2>&1
unpinned_status=$?
set -e

[[ "$tampered_status" -eq 5 ]] || {
  echo "tampered source returned $tampered_status, expected 5" >&2
  exit 1
}
[[ "$unpinned_status" -eq 2 ]] || {
  echo "unpinned source returned $unpinned_status, expected 2" >&2
  exit 1
}

echo "bootstrap tests OK"
