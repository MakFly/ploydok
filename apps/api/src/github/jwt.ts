// SPDX-License-Identifier: AGPL-3.0-only
import { createSign } from "node:crypto";

/**
 * Sign a GitHub App JWT using RS256 (native Node.js crypto — no external deps).
 *
 * @param pem    - RSA private key PEM (from GitHub App credentials)
 * @param appId  - GitHub App ID (numeric string)
 * @param ttlSec - Token TTL in seconds (default 600 = 10 min, GitHub max is 10 min)
 */
export function signAppJwt(pem: string, appId: string, ttlSec = 600): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat: now - 30, exp: now + ttlSec, iss: appId };

  const b64 = (o: unknown): string =>
    Buffer.from(JSON.stringify(o)).toString("base64url");

  const data = `${b64(header)}.${b64(payload)}`;
  const sig = createSign("RSA-SHA256").update(data).sign(pem, "base64url");

  return `${data}.${sig}`;
}
