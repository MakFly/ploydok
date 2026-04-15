#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-only
# Claude Code WorktreeCreate hook. Reads JSON on stdin:
#   { "worktree_path": "...", "branch_name": "...", "commit_sha": "..." }
# On success, the worktree path is echoed on stdout.
set -euo pipefail

INPUT=$(cat)
WORKTREE_PATH=$(echo "$INPUT" | jq -r '.worktree_path')
BRANCH_NAME=$(echo "$INPUT" | jq -r '.branch_name')
COMMIT_SHA=$(echo "$INPUT" | jq -r '.commit_sha // empty')

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

if [ -n "$COMMIT_SHA" ]; then
  git worktree add -b "$BRANCH_NAME" "$WORKTREE_PATH" "$COMMIT_SHA" >&2
else
  git worktree add -b "$BRANCH_NAME" "$WORKTREE_PATH" HEAD >&2
fi

echo "$WORKTREE_PATH"
