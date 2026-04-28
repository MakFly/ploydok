// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac } from "node:crypto"

export function signGitHubPayload(secret: string, payload: string): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`
}

export function buildPullRequestPayload(input: {
  action: "opened" | "synchronize" | "closed"
  repoFullName: string
  prNumber: number
  headSha: string
  installationId?: number
}): Record<string, unknown> {
  return {
    action: input.action,
    number: input.prNumber,
    pull_request: {
      number: input.prNumber,
      head: { sha: input.headSha, ref: `pr-${input.prNumber}` },
    },
    repository: { full_name: input.repoFullName },
    installation: { id: input.installationId ?? 1 },
  }
}
