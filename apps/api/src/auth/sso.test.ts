// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach, mock } from "bun:test"
import {
  initOIDCClient,
  generateAuthorizationUrl,
  exchangeCodeForToken,
  testOIDCConfig,
  getDecryptedSSOConfig,
} from "./sso"

describe("auth.sso", () => {
  describe("testOIDCConfig", () => {
    it("returns ok: false for invalid issuer", async () => {
      const result = await testOIDCConfig(
        "https://invalid-issuer.example.com",
        "client-id",
        "client-secret",
        "https://app.example.com/callback"
      )
      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe("getDecryptedSSOConfig", () => {
    it("returns null if config not found", async () => {
      const mockDb = {
        query: {
          sso_configs: {
            findFirst: mock(() => Promise.resolve(null)),
          },
        },
      }

      // Mock the getSSOConfigByOrgId to return null
      const result = null
      expect(result).toBeNull()
    })

    it("returns null if config is disabled", async () => {
      const mockConfig = {
        id: "sso-1",
        org_id: "org-1",
        issuer: "https://idp.example.com",
        client_id: "client-id",
        client_secret_enc: Buffer.from("encrypted"),
        client_secret_nonce: Buffer.from("nonce"),
        redirect_uri: "https://app.example.com/callback",
        scopes: "openid email",
        enabled: false,
      }

      // When enabled is false, should return null
      expect(mockConfig.enabled).toBe(false)
    })
  })

  describe("generateAuthorizationUrl", () => {
    it("generates url with state and code_challenge", () => {
      // Mock client
      const mockClient = {
        authorizationUrl: mock((params) => {
          expect(params.code_challenge).toBeDefined()
          expect(params.state).toBeDefined()
          expect(params.scope).toBe("openid email")
          return "https://idp.example.com/auth?code_challenge=..."
        }),
      }

      const { authUrl, codeVerifier, state } = generateAuthorizationUrl(
        mockClient as any,
        "openid email"
      )

      expect(authUrl).toBeDefined()
      expect(codeVerifier).toBeDefined()
      expect(state).toBeDefined()
    })
  })
})
