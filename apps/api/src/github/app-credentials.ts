// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from "node:crypto";
import { loadMasterKey } from "../keyring";
import { GitHubAppCredentialsError } from "./errors";

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
  return decryptWithKey(enc, nonce, cryptoKey);
}

async function decryptWithKey(
  enc: Buffer,
  nonce: Buffer,
  cryptoKey: CryptoKey,
): Promise<string> {
  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toUint8Array(nonce) },
    cryptoKey,
    toUint8Array(enc),
  );
  return new TextDecoder().decode(plainBuffer);
}

/**
 * Decrypts the stored GitHub App private key and normalizes ciphertext
 * authentication failures to an error callers can handle safely.
 */
export async function decryptAppPrivateKey(config: {
  pem_enc: unknown;
  pem_nonce: unknown;
}): Promise<string> {
  // Loading or importing MASTER_KEY is an infrastructure/configuration step.
  // Keep those failures as 5xx errors: reconnecting the App cannot repair an
  // invalid instance key. Only an AES-GCM failure against the stored payload
  // means the persisted credential is unreadable with an otherwise valid key.
  const masterKey = await loadMasterKey();
  const cryptoKey = await deriveCryptoKey(masterKey);

  try {
    return await decryptWithKey(
      config.pem_enc as Buffer,
      config.pem_nonce as Buffer,
      cryptoKey,
    );
  } catch (cause) {
    throw new GitHubAppCredentialsError(cause);
  }
}
