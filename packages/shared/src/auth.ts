// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export const RegisterStartBodySchema = z.object({
  email: z.string().email(),
  display_name: z.string().min(1).max(100),
});
export type RegisterStartBody = z.infer<typeof RegisterStartBodySchema>;

export const RegisterOptionsResponseSchema = z.object({
  options: z.unknown(), // PublicKeyCredentialCreationOptionsJSON from @simplewebauthn
  userId: z.string(),
});
export type RegisterOptionsResponse = z.infer<typeof RegisterOptionsResponseSchema>;

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export const LoginStartBodySchema = z.object({
  email: z.string().email(),
});
export type LoginStartBody = z.infer<typeof LoginStartBodySchema>;

export const LoginOptionsResponseSchema = z.object({
  options: z.unknown(), // PublicKeyCredentialRequestOptionsJSON from @simplewebauthn
});
export type LoginOptionsResponse = z.infer<typeof LoginOptionsResponseSchema>;

// ---------------------------------------------------------------------------
// User / Session types
// ---------------------------------------------------------------------------

export const MeSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  display_name: z.string(),
  created_at: z.string().datetime(),
  has_passkey_plus: z.boolean(), // >= 2 passkeys
  has_backup_codes: z.boolean(), // >= 1 non-consumed backup code
  needs_second_factor: z.boolean(),
});
export type Me = z.infer<typeof MeSchema>;

export const SessionInfoSchema = z.object({
  id: z.string(),
  user_agent: z.string(),
  ip: z.string(),
  created_at: z.string().datetime(),
  last_seen_at: z.string().datetime(),
  expires_at: z.string().datetime(),
  is_current: z.boolean(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

export const PasskeyInfoSchema = z.object({
  id: z.string(),
  credential_id: z.string(),
  device_name: z.string().nullable(),
  created_at: z.string().datetime(),
  last_used_at: z.string().datetime(),
});
export type PasskeyInfo = z.infer<typeof PasskeyInfoSchema>;

// ---------------------------------------------------------------------------
// Backup codes
// ---------------------------------------------------------------------------

export const BackupCodesResponseSchema = z.object({
  codes: z.array(z.string()).length(10),
});
export type BackupCodesResponse = z.infer<typeof BackupCodesResponseSchema>;

export const ConsumeBackupCodeBodySchema = z.object({
  email: z.string().email(),
  code: z.string(),
});
export type ConsumeBackupCodeBody = z.infer<typeof ConsumeBackupCodeBodySchema>;
