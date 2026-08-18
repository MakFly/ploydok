// SPDX-License-Identifier: AGPL-3.0-only
import { eq } from "drizzle-orm"
import { gitlab_tokens } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { getGitLabConfig } from "@ploydok/db/queries"
import { decryptField, encryptField } from "../github/app-credentials"
import { GitLabProvider } from "./client"
import type { GitRepo } from "@ploydok/shared"

const TOKEN_REFRESH_SKEW_MS = 60_000

export class GitLabConnectionError extends Error {
  constructor(
    public readonly code:
      | "not_configured"
      | "not_connected"
      | "expired"
      | "refresh_failed"
      | "project_mismatch"
      | "branch_missing",
    message: string
  ) {
    super(message)
    this.name = "GitLabConnectionError"
  }
}

export interface ResolvedGitLabConnection {
  provider: GitLabProvider
  accessToken: string
  instanceUrl: string
  credentialUserId: string
  installationId: string
}

export interface ResolvedGitLabProjectSelection extends ResolvedGitLabConnection {
  project: GitRepo
}

/**
 * Resolve a usable GitLab credential. Expired tokens are refreshed under a
 * row lock so concurrent routes/workers cannot rotate the same refresh token.
 */
export async function resolveGitLabConnection(
  db: Db,
  userId: string
): Promise<ResolvedGitLabConnection> {
  const config = await getGitLabConfig(db)
  if (!config) {
    throw new GitLabConnectionError(
      "not_configured",
      "GitLab is not configured"
    )
  }

  const accessToken = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(gitlab_tokens)
      .where(eq(gitlab_tokens.user_id, userId))
      .limit(1)
      .for("update")
    const row = rows[0]
    if (!row) {
      throw new GitLabConnectionError(
        "not_connected",
        "GitLab is not connected"
      )
    }

    const expiresSoon =
      row.expires_at !== null &&
      row.expires_at.getTime() <= Date.now() + TOKEN_REFRESH_SKEW_MS
    if (!expiresSoon) {
      return decryptField(
        row.access_token_enc as Buffer,
        row.access_token_nonce as Buffer
      )
    }

    if (!row.refresh_token_enc || !row.refresh_token_nonce) {
      throw new GitLabConnectionError(
        "expired",
        "GitLab token expired; reconnect the account"
      )
    }

    const [clientSecret, refreshToken] = await Promise.all([
      decryptField(
        config.client_secret_enc as Buffer,
        config.client_secret_nonce as Buffer
      ),
      decryptField(
        row.refresh_token_enc as Buffer,
        row.refresh_token_nonce as Buffer
      ),
    ])
    const response = await fetch(`${config.instance_url}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: config.client_id,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    })
    if (!response.ok) {
      throw new GitLabConnectionError(
        "refresh_failed",
        `GitLab token refresh failed (${response.status})`
      )
    }
    const refreshed = (await response.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      created_at?: number
    }
    if (!refreshed.access_token) {
      throw new GitLabConnectionError(
        "refresh_failed",
        "GitLab token refresh returned no access token"
      )
    }
    const encryptedAccess = await encryptField(refreshed.access_token)
    const encryptedRefresh = refreshed.refresh_token
      ? await encryptField(refreshed.refresh_token)
      : null
    const createdAtSeconds =
      refreshed.created_at ?? Math.floor(Date.now() / 1000)
    const expiresAt = refreshed.expires_in
      ? new Date((createdAtSeconds + refreshed.expires_in) * 1000)
      : null

    await tx
      .update(gitlab_tokens)
      .set({
        access_token_enc: encryptedAccess.enc,
        access_token_nonce: encryptedAccess.nonce,
        refresh_token_enc: encryptedRefresh?.enc ?? row.refresh_token_enc,
        refresh_token_nonce: encryptedRefresh?.nonce ?? row.refresh_token_nonce,
        expires_at: expiresAt,
        updated_at: new Date(),
      })
      .where(eq(gitlab_tokens.user_id, userId))

    return refreshed.access_token
  })

  return {
    provider: new GitLabProvider(config.instance_url),
    accessToken,
    instanceUrl: config.instance_url,
    credentialUserId: userId,
    installationId: `gitlab:user:${userId}`,
  }
}

export async function assertGitLabProjectSelection(
  db: Db,
  input: {
    credentialUserId: string
    projectId: number
    fullName: string
    branch: string
  }
): Promise<ResolvedGitLabProjectSelection> {
  const connection = await resolveGitLabConnection(db, input.credentialUserId)
  const project = await connection.provider.getRepo(
    connection.accessToken,
    input.fullName
  )
  if (
    String(project.id) !== String(input.projectId) ||
    project.fullName !== input.fullName
  ) {
    throw new GitLabConnectionError(
      "project_mismatch",
      "GitLab project id and path do not match"
    )
  }
  const branches = await connection.provider.listBranches(
    connection.accessToken,
    input.fullName
  )
  if (!branches.some((branch) => branch.name === input.branch)) {
    throw new GitLabConnectionError(
      "branch_missing",
      `GitLab branch does not exist: ${input.branch}`
    )
  }
  return { ...connection, project }
}
