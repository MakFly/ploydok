// SPDX-License-Identifier: AGPL-3.0-only
import { X509Certificate, createPublicKey, createPrivateKey } from "node:crypto"

export interface CertParseResult {
  ok: boolean
  notBefore?: Date
  notAfter?: Date
  sans?: string[]
  error?: string
}

/**
 * Parse, validate, and verify a PEM cert+key pair for a given domain.
 *
 * Checks:
 * - cert is parseable as X.509
 * - notAfter > now (not expired)
 * - SANs cover the target domain (exact match or wildcard *.parent covers subdomain)
 * - private key matches the certificate's public key
 */
export function parseAndValidateCert(
  pemCert: string,
  pemKey: string,
  domain: string,
): CertParseResult {
  let cert: X509Certificate
  try {
    cert = new X509Certificate(pemCert)
  } catch (err) {
    return { ok: false, error: `Cannot parse certificate: ${String(err)}` }
  }

  const now = new Date()
  const notBefore = new Date(cert.validFrom)
  const notAfter = new Date(cert.validTo)

  if (notAfter <= now) {
    return {
      ok: false,
      notBefore,
      notAfter,
      error: `Certificate expired at ${notAfter.toISOString()}`,
    }
  }

  // Parse SANs from subjectAltName extension
  const sans = parseSans(cert)

  if (!domainMatchesSans(domain, sans)) {
    return {
      ok: false,
      notBefore,
      notAfter,
      sans,
      error: `Domain ${domain} not covered by certificate SANs: ${sans.join(", ")}`,
    }
  }

  // Verify key matches cert
  try {
    const pubFromCert = cert.publicKey
    const privKey = createPrivateKey(pemKey)
    const pubFromKey = createPublicKey(privKey)
    // Compare DER-encoded public keys
    const certPubDer = pubFromCert.export({ type: "spki", format: "der" })
    const keyPubDer = pubFromKey.export({ type: "spki", format: "der" })
    if (!certPubDer.equals(keyPubDer)) {
      return {
        ok: false,
        notBefore,
        notAfter,
        sans,
        error: "Private key does not match certificate public key",
      }
    }
  } catch (err) {
    return {
      ok: false,
      notBefore,
      notAfter,
      sans,
      error: `Cannot parse private key: ${String(err)}`,
    }
  }

  return { ok: true, notBefore, notAfter, sans }
}

function parseSans(cert: X509Certificate): string[] {
  const san = cert.subjectAltName
  if (!san) return []
  // subjectAltName format: "DNS:example.com, DNS:www.example.com, IP Address:1.2.3.4"
  return san
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("DNS:"))
    .map((part) => part.slice(4).toLowerCase().trim())
}

function domainMatchesSans(domain: string, sans: string[]): boolean {
  const d = domain.toLowerCase()
  for (const san of sans) {
    if (san === d) return true
    // Wildcard: *.example.com covers foo.example.com but not example.com or foo.bar.example.com
    if (san.startsWith("*.")) {
      const wildcardParent = san.slice(2)
      const parts = d.split(".")
      if (parts.length >= 2) {
        const domainParent = parts.slice(1).join(".")
        if (domainParent === wildcardParent) return true
      }
    }
  }
  return false
}
