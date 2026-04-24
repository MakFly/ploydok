// SPDX-License-Identifier: AGPL-3.0-only
import { jwtVerify } from "jose"
import { env } from "../env"
import { LicenseClaimsSchema } from "@ploydok/shared"

// Public key DEMO pour dev (ne correspond à rien)
// À remplacer par la clé réelle ou utiliser PLOYDOK_LICENSE_PUBLIC_KEY env var
const DEMO_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE7m8y4nY+e4VwPCnEPe+3Y3yI
KXfKTi5Y5cLsM7vN5L+r5i3vN5g+t7j8v5m2R5n9w5o3x5p5y5q7z7r9s9t
-----END PUBLIC KEY-----`

export class InvalidLicenseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidLicenseError"
  }
}

/**
 * Get the public key for license JWT verification.
 * Falls back to env var PLOYDOK_LICENSE_PUBLIC_KEY if set,
 * otherwise falls back to DEMO key in dev.
 * In prod without env var, rejects all activations.
 */
function getPublicKeyPem(): string {
  if (env.PLOYDOK_LICENSE_PUBLIC_KEY) {
    return env.PLOYDOK_LICENSE_PUBLIC_KEY
  }

  // En dev, utilise la clé DEMO
  if (env.NODE_ENV !== "prod") {
    return DEMO_PUBLIC_KEY_PEM
  }

  // En prod sans env var, rejette
  throw new InvalidLicenseError(
    "LICENSE_NOT_CONFIGURED: PLOYDOK_LICENSE_PUBLIC_KEY env var not set"
  )
}

/**
 * Convert PEM public key to CryptoKey for jose.
 */
async function getPublicKey(): Promise<CryptoKey> {
  const pem = getPublicKeyPem()
  const binaryDer = Buffer.from(pem.replace(/-----[^-]*-----/g, ""), "base64")
  return crypto.subtle.importKey(
    "spki",
    binaryDer,
    {
      name: "ECDSA",
      namedCurve: "P-256",
      hash: "SHA-256",
    },
    false,
    ["verify"]
  )
}

/**
 * Verify and parse a license JWT.
 * Throws InvalidLicenseError if verification fails or claims are invalid.
 */
export async function verifyLicenseJwt(token: string) {
  try {
    const publicKey = await getPublicKey()
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: ["ES256"],
      issuer: "ploydok",
    })

    const claims = LicenseClaimsSchema.parse(payload)

    // Check expiration
    const now = Math.floor(Date.now() / 1000)
    if (claims.exp <= now) {
      throw new InvalidLicenseError("License JWT has expired")
    }

    return claims
  } catch (err) {
    if (err instanceof InvalidLicenseError) {
      throw err
    }
    throw new InvalidLicenseError(
      `Failed to verify license JWT: ${err instanceof Error ? err.message : "unknown error"}`
    )
  }
}
