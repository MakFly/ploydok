// SPDX-License-Identifier: AGPL-3.0-only
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type GenerateRegistrationOptionsOpts,
  type VerifyRegistrationResponseOpts,
  type GenerateAuthenticationOptionsOpts,
  type VerifyAuthenticationResponseOpts,
} from "@simplewebauthn/server";
import { env } from "../env";

// ---------------------------------------------------------------------------
// RP configuration
// ---------------------------------------------------------------------------

const RP_NAME = "Ploydok";

function getRpID(): string {
  return Bun.env["WEBAUTHN_RP_ID"] ?? new URL(env.WEB_ORIGIN).hostname;
}

function getOrigin(): string {
  return env.WEB_ORIGIN;
}

// ---------------------------------------------------------------------------
// Registration helpers
// ---------------------------------------------------------------------------

export type GenerateRegOpts = Omit<
  GenerateRegistrationOptionsOpts,
  "rpName" | "rpID"
>;

export async function generateRegOptions(opts: GenerateRegOpts) {
  return generateRegistrationOptions({
    ...opts,
    rpName: RP_NAME,
    rpID: getRpID(),
  });
}

export async function verifyRegResponse(opts: Omit<VerifyRegistrationResponseOpts, "expectedRPID" | "expectedOrigin">) {
  return verifyRegistrationResponse({
    ...opts,
    expectedRPID: getRpID(),
    expectedOrigin: getOrigin(),
  });
}

// ---------------------------------------------------------------------------
// Authentication helpers
// ---------------------------------------------------------------------------

export type GenerateAuthOpts = Omit<
  GenerateAuthenticationOptionsOpts,
  "rpID"
>;

export async function generateAuthOptions(opts: GenerateAuthOpts = {}) {
  return generateAuthenticationOptions({
    ...opts,
    rpID: getRpID(),
  });
}

export async function verifyAuthResponse(
  opts: Omit<VerifyAuthenticationResponseOpts, "expectedRPID" | "expectedOrigin">,
) {
  return verifyAuthenticationResponse({
    ...opts,
    expectedRPID: getRpID(),
    expectedOrigin: getOrigin(),
  });
}
