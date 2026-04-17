// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from "node:crypto";
import { loadMasterKey } from "../keyring";

// ---------------------------------------------------------------------------
// AES-256-GCM helpers (reuse same scheme as routes/github.ts)
// ---------------------------------------------------------------------------

function toUint8Array(src: Uint8Array | Buffer): Uint8Array<ArrayBuffer> {
  const copy = Buffer.from(src);
  return new Uint8Array(copy.buffer, copy.byteOffset, copy.byteLength) as Uint8Array<ArrayBuffer>;
}

async function deriveCryptoKey(masterKey: string): Promise<CryptoKey> {
  // masterKey is base64-encoded 32 bytes from keyring
  const raw = toUint8Array(Buffer.from(masterKey, "base64"));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptField(plaintext: string): Promise<{ enc: Buffer; nonce: Buffer }> {
  const masterKey = await loadMasterKey();
  const cryptoKey = await deriveCryptoKey(masterKey);
  const nonce = randomBytes(12);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toUint8Array(nonce) },
    cryptoKey,
    new TextEncoder().encode(plaintext),
  );
  return { enc: Buffer.from(cipherBuffer), nonce };
}

export async function decryptField(enc: Buffer, nonce: Buffer): Promise<string> {
  const masterKey = await loadMasterKey();
  const cryptoKey = await deriveCryptoKey(masterKey);
  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toUint8Array(nonce) },
    cryptoKey,
    toUint8Array(enc),
  );
  return new TextDecoder().decode(plainBuffer);
}
