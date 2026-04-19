// SPDX-License-Identifier: AGPL-3.0-only
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { env } from "../env";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALG = "HS256";
export const ACCESS_TTL = 10 * 60; // 10 minutes in seconds
const ISSUER = "ploydok";

export function getAccessExpiresAt(): number {
  return Math.floor(Date.now() / 1000) + ACCESS_TTL;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AccessTokenPayload extends JWTPayload {
  sub: string; // user id
  email: string;
  session_id: string;
}

// ---------------------------------------------------------------------------
// Key
// ---------------------------------------------------------------------------

function getSecretKey(): Uint8Array {
  return new TextEncoder().encode(env.SESSION_SECRET);
}

// ---------------------------------------------------------------------------
// Sign / Verify access token
// ---------------------------------------------------------------------------

export async function signAccessToken(payload: {
  userId: string;
  email: string;
  sessionId: string;
}): Promise<string> {
  const key = getSecretKey();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    email: payload.email,
    session_id: payload.sessionId,
  })
    .setProtectedHeader({ alg: ALG })
    .setSubject(payload.userId)
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TTL)
    .setIssuer(ISSUER)
    .sign(key);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const key = getSecretKey();
  const { payload } = await jwtVerify(token, key, {
    algorithms: [ALG],
    issuer: ISSUER,
  });
  return payload as AccessTokenPayload;
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

export const ACCESS_COOKIE = "ploydok_access";
export const REFRESH_COOKIE = "ploydok_refresh";
export const ACCESS_MAX_AGE = ACCESS_TTL;
export const REFRESH_MAX_AGE = 7 * 24 * 60 * 60; // 7 days

export function buildCookieStr(
  name: string,
  value: string,
  maxAge: number,
  secure: boolean,
): string {
  // SameSite=Lax : envoyé sur same-site (y compris cross-port comme :5173→:3335)
  // ET sur top-level GET — évite les pièges de Strict sur F5 ou navigations.
  // En prod, Secure est ajouté via le flag et fait foi.
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
