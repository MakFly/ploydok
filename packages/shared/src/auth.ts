// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod"
import { OrganizationSummarySchema } from "./organizations"

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export const RegisterStartBodySchema = z.object({
  email: z.string().email(),
  display_name: z.string().min(1).max(100),
})
export type RegisterStartBody = z.infer<typeof RegisterStartBodySchema>

export const RegisterOptionsResponseSchema = z.object({
  options: z.unknown(), // PublicKeyCredentialCreationOptionsJSON from @simplewebauthn
  userId: z.string(),
})
export type RegisterOptionsResponse = z.infer<
  typeof RegisterOptionsResponseSchema
>

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export const LoginStartBodySchema = z.object({
  email: z.string().email(),
})
export type LoginStartBody = z.infer<typeof LoginStartBodySchema>

export const LoginOptionsResponseSchema = z.object({
  options: z.unknown(), // PublicKeyCredentialRequestOptionsJSON from @simplewebauthn
})
export type LoginOptionsResponse = z.infer<typeof LoginOptionsResponseSchema>

// ---------------------------------------------------------------------------
// First-boot admin
// ---------------------------------------------------------------------------

export const ADMIN_PASSWORD_MIN_CHARS = 12
// bcrypt tronque silencieusement au-delà de 72 octets : refuser plutôt que
// laisser un mot de passe amputé devenir le secret du compte admin.
export const ADMIN_PASSWORD_MAX_BYTES = 72

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

export const AdminPasswordSchema = z
  .string()
  .min(
    ADMIN_PASSWORD_MIN_CHARS,
    `Password must be at least ${ADMIN_PASSWORD_MIN_CHARS} characters`
  )
  .refine(
    (value) => utf8ByteLength(value) <= ADMIN_PASSWORD_MAX_BYTES,
    `Password must be at most ${ADMIN_PASSWORD_MAX_BYTES} bytes`
  )

/** Corps accepté par `POST /auth/setup/password`. */
export const SetupAdminBodySchema = z.object({
  token: z.string().optional(),
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Enter a valid email address")
    .toLowerCase(),
  display_name: z
    .string()
    .trim()
    .min(1, "Display name is required")
    .max(100, "Display name must be at most 100 characters"),
  password: AdminPasswordSchema,
})
export type SetupAdminBody = z.infer<typeof SetupAdminBodySchema>

/** Ce que le wizard valide côté navigateur : le corps + la confirmation. */
export const SetupAdminFormSchema = SetupAdminBodySchema.omit({ token: true })
  .extend({ password_confirm: z.string().min(1, "Confirm your password") })
  .refine((value) => value.password === value.password_confirm, {
    message: "Passwords do not match",
    path: ["password_confirm"],
  })
export type SetupAdminForm = z.infer<typeof SetupAdminFormSchema>

// ---------------------------------------------------------------------------
// User / Session types
// ---------------------------------------------------------------------------

export const MeSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  display_name: z.string(),
  created_at: z.string().datetime(),
  default_organization: OrganizationSummarySchema.nullable(),
  accessExpiresAt: z.number(), // unix seconds, when the current access token expires
  has_passkey_plus: z.boolean(), // >= 2 passkeys
  has_backup_codes: z.boolean(), // >= 1 non-consumed backup code
  has_totp: z.boolean(), // verified TOTP enrolled
  require_totp_for_secret_reveal: z.boolean(),
  needs_second_factor: z.boolean(),
  is_instance_admin: z.boolean(),
})
export type Me = z.infer<typeof MeSchema>

export const RefreshResponseSchema = z.object({
  ok: z.literal(true),
  accessExpiresAt: z.number(),
})
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>

export const SessionInfoSchema = z.object({
  id: z.string(),
  user_agent: z.string(),
  ip: z.string(),
  created_at: z.string().datetime(),
  last_seen_at: z.string().datetime(),
  expires_at: z.string().datetime(),
  is_current: z.boolean(),
})
export type SessionInfo = z.infer<typeof SessionInfoSchema>

export const PasskeyInfoSchema = z.object({
  id: z.string(),
  credential_id: z.string(),
  device_name: z.string().nullable(),
  created_at: z.string().datetime(),
  last_used_at: z.string().datetime(),
})
export type PasskeyInfo = z.infer<typeof PasskeyInfoSchema>

// ---------------------------------------------------------------------------
// Backup codes
// ---------------------------------------------------------------------------

export const BackupCodesResponseSchema = z.object({
  codes: z.array(z.string()).length(10),
})
export type BackupCodesResponse = z.infer<typeof BackupCodesResponseSchema>

export const ConsumeBackupCodeBodySchema = z.object({
  email: z.string().email(),
  code: z.string(),
})
export type ConsumeBackupCodeBody = z.infer<typeof ConsumeBackupCodeBodySchema>
