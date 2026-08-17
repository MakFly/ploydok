// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto"

/** Stable, non-secret identity for the encrypted GitHub App signing config. */
export function getGitHubAppConfigFingerprint(config: {
  app_id: string
  pem_enc: unknown
  pem_nonce: unknown
}): string {
  return createHash("sha256")
    .update(config.app_id)
    .update("\0")
    .update(Buffer.from(config.pem_enc as Buffer))
    .update("\0")
    .update(Buffer.from(config.pem_nonce as Buffer))
    .digest("hex")
}
