// SPDX-License-Identifier: AGPL-3.0-only
import bcrypt from "bcryptjs"

const BCRYPT_ROUNDS = 12
const MIN_PASSWORD_CHARS = 12
const MAX_BCRYPT_BYTES = 72

export function validateAdminPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_CHARS) {
    return `Password must be at least ${MIN_PASSWORD_CHARS} characters`
  }
  if (Buffer.byteLength(password, "utf8") > MAX_BCRYPT_BYTES) {
    return `Password must be at most ${MAX_BCRYPT_BYTES} bytes`
  }
  return null
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash)
}
