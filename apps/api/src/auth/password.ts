// SPDX-License-Identifier: AGPL-3.0-only
import bcrypt from "bcryptjs"
import { AdminPasswordSchema, firstErrorMessage } from "@ploydok/shared"

const BCRYPT_ROUNDS = 12

// Délègue au schéma partagé : le wizard valide le même mot de passe côté
// navigateur, et deux bornes divergentes donneraient un formulaire vert et un
// 400 au submit.
export function validateAdminPassword(password: string): string | null {
  const parsed = AdminPasswordSchema.safeParse(password)
  return parsed.success ? null : firstErrorMessage(parsed.error)
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
