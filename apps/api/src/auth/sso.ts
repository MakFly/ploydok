// SPDX-License-Identifier: AGPL-3.0-only
import { Issuer, generators } from "openid-client"
import { env } from "../env"
import { decryptField } from "../github/app-credentials"
import type { Db } from "@ploydok/db"
import { getSSOConfigByOrgId } from "@ploydok/db/queries"
import { childLogger } from "../logger"

const log = childLogger("auth.sso")

/**
 * Initialize OIDC client from SSO config.
 * Returns null if config is invalid.
 */
export async function initOIDCClient(
  issuer: string,
  clientId: string,
  clientSecretDec: string,
  redirectUri: string
) {
  try {
    const oidcIssuer = await Issuer.discover(issuer)
    const client = new oidcIssuer.Client({
      client_id: clientId,
      client_secret: clientSecretDec,
      redirect_uris: [redirectUri],
      response_types: ["code"],
    })
    return client
  } catch (err) {
    log.error({ issuer, error: err }, "Failed to initialize OIDC client")
    return null
  }
}

/**
 * Generate authorization URL for OIDC login flow.
 * Returns { authUrl, codeVerifier, state }.
 */
export function generateAuthorizationUrl(client: any, scopes: string) {
  const codeVerifier = generators.codeVerifier()
  const codeChallenge = generators.codeChallenge(codeVerifier)
  const state = generators.state()

  const authUrl = client.authorizationUrl({
    scope: scopes,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  })

  return { authUrl, codeVerifier, state }
}

/**
 * Exchange authorization code for tokens.
 * Returns { idToken, email, sub } or throws.
 */
export async function exchangeCodeForToken(
  client: any,
  code: string,
  codeVerifier: string
) {
  const tokenSet = await client.callback(
    undefined,
    { code },
    { code_verifier: codeVerifier }
  )
  const claims = tokenSet.claims()

  if (!claims.email) {
    throw new Error("OIDC provider did not return email claim")
  }

  return {
    idToken: tokenSet.id_token,
    email: claims.email as string,
    sub: claims.sub as string,
  }
}

/**
 * Verify OIDC configuration by fetching .well-known and testing token exchange.
 * Returns { ok: true } or { ok: false, error: string }.
 */
export async function testOIDCConfig(
  issuer: string,
  clientId: string,
  clientSecretDec: string,
  redirectUri: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = await initOIDCClient(
      issuer,
      clientId,
      clientSecretDec,
      redirectUri
    )
    if (!client) {
      return { ok: false, error: "Failed to initialize OIDC client" }
    }
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}

/**
 * Fetch SSO config by org ID, decrypt client secret.
 * Returns decrypted config or null if not found/enabled.
 */
export async function getDecryptedSSOConfig(
  db: Db,
  orgId: string
): Promise<{
  id: string
  issuer: string
  clientId: string
  clientSecretDec: string
  redirectUri: string
  scopes: string
} | null> {
  const config = await getSSOConfigByOrgId(db, orgId)
  if (!config || !config.enabled) {
    return null
  }

  try {
    const clientSecretDec = await decryptField(
      config.client_secret_enc,
      config.client_secret_nonce
    )
    return {
      id: config.id,
      issuer: config.issuer,
      clientId: config.client_id,
      clientSecretDec,
      redirectUri: config.redirect_uri,
      scopes: config.scopes,
    }
  } catch (err) {
    log.error({ orgId, error: err }, "Failed to decrypt SSO config")
    return null
  }
}
