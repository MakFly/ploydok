// SPDX-License-Identifier: AGPL-3.0-only

export class GitHubAppCredentialsError extends Error {
  readonly cause: unknown

  constructor(cause: unknown) {
    super("GitHub App private key could not be decrypted")
    this.name = "GitHubAppCredentialsError"
    this.cause = cause
  }
}
