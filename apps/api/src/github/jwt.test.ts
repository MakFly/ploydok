// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { signAppJwt } from "./jwt";

// ---------------------------------------------------------------------------
// Generate a throwaway RSA key pair for tests
// ---------------------------------------------------------------------------

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

function decodeB64url(s: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as Record<string, unknown>;
}

describe("signAppJwt", () => {
  it("returns a 3-part JWT string", () => {
    const jwt = signAppJwt(privateKey, "123456");
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
  });

  it("header has alg=RS256 and typ=JWT", () => {
    const jwt = signAppJwt(privateKey, "123456");
    const header = decodeB64url(jwt.split(".")[0]!);
    expect(header["alg"]).toBe("RS256");
    expect(header["typ"]).toBe("JWT");
  });

  it("payload has iss equal to appId", () => {
    const jwt = signAppJwt(privateKey, "987654");
    const payload = decodeB64url(jwt.split(".")[1]!);
    expect(payload["iss"]).toBe("987654");
  });

  it("payload exp is iat+ttl (default 600s)", () => {
    const jwt = signAppJwt(privateKey, "123456");
    const payload = decodeB64url(jwt.split(".")[1]!);
    const iat = payload["iat"] as number;
    const exp = payload["exp"] as number;
    // iat is now-30, exp is now+600 → diff should be ~630
    expect(exp - iat).toBe(630);
  });

  it("payload exp respects custom ttlSec", () => {
    const jwt = signAppJwt(privateKey, "123456", 120);
    const payload = decodeB64url(jwt.split(".")[1]!);
    const iat = payload["iat"] as number;
    const exp = payload["exp"] as number;
    expect(exp - iat).toBe(150); // 120 + 30 skew
  });

  it("signature verifies with the corresponding public key", () => {
    const jwt = signAppJwt(privateKey, "123456");
    const [header, payload, sig] = jwt.split(".");
    const data = `${header}.${payload}`;
    const verifier = createVerify("RSA-SHA256");
    verifier.update(data);
    const ok = verifier.verify(publicKey, sig!, "base64url");
    expect(ok).toBe(true);
  });
});
