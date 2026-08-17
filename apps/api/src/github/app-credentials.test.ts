// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, mock } from "bun:test"
import { GitHubAppCredentialsError } from "./errors"

let masterKey = Buffer.alloc(32, 7).toString("base64")
let loadFailure: Error | null = null

mock.module("../keyring", () => ({
  loadMasterKey: async () => {
    if (loadFailure) throw loadFailure
    return masterKey
  },
}))

const { decryptAppPrivateKey } = await import("./app-credentials")

const storedPrivateKey = {
  pem_enc: Buffer.from("not-a-valid-aes-gcm-payload"),
  pem_nonce: Buffer.alloc(12, 3),
}

afterEach(() => {
  masterKey = Buffer.alloc(32, 7).toString("base64")
  loadFailure = null
})

describe("decryptAppPrivateKey error classification", () => {
  it("keeps master-key loading failures as infrastructure errors", async () => {
    const expected = new Error("keyring unavailable")
    loadFailure = expected

    try {
      await decryptAppPrivateKey(storedPrivateKey)
      throw new Error("expected decryptAppPrivateKey to reject")
    } catch (error) {
      expect(error).toBe(expected)
      expect(error).not.toBeInstanceOf(GitHubAppCredentialsError)
    }
  })

  it("keeps invalid master-key material as a configuration error", async () => {
    masterKey = Buffer.alloc(8, 1).toString("base64")

    try {
      await decryptAppPrivateKey(storedPrivateKey)
      throw new Error("expected decryptAppPrivateKey to reject")
    } catch (error) {
      expect(error).not.toBeInstanceOf(GitHubAppCredentialsError)
    }
  })

  it("classifies only ciphertext authentication failures as unreadable", async () => {
    try {
      await decryptAppPrivateKey(storedPrivateKey)
      throw new Error("expected decryptAppPrivateKey to reject")
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubAppCredentialsError)
    }
  })
})
