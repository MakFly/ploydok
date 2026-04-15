#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-only
# Claude Code WorktreeRemove hook. Reads JSON on stdin:
#   { "worktree_path": "...", "branch_name": "..." }
set -euo pipefail

INPUT=$(cat)
WORKTREE_PATH=$(echo "$INPUT" | jq -r '.worktree_path')
BRANCH_NAME=$(echo "$INPUT" | jq -r '.branch_name // empty')

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

git worktree remove --force "$WORKTREE_PATH" 2>/dev/null || true
if [ -n "$BRANCH_NAME" ]; then
  git branch -D "$BRANCH_NAME" 2>/dev/null || true
fi

exit 0
