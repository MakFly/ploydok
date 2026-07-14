// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import { nanoid } from "nanoid"
import { eq, and, sql } from "drizzle-orm"
import {
  users,
  passkeys,
  sessions as sessionsTable,
  totp_secrets,
} from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { env } from "../env"
import {
  generateRegOptions,
  verifyRegResponse,
  generateAuthOptions,
  verifyAuthResponse,
} from "../auth/webauthn"
import {
  signAccessToken,
  buildCookieStr,
  getAccessExpiresAt,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  ACCESS_MAX_AGE,
  REFRESH_MAX_AGE,
  shouldUseSecureCookies,
} from "../auth/jwt"
import {
  hashPassword,
  validateAdminPassword,
  verifyPassword,
} from "../auth/password"
import * as BackupCodes from "../auth/backup-codes"
import * as Sessions from "../auth/sessions"
import { setChallenge, consumeChallenge } from "../auth/challenges"
import {
  requireAuth,
  requireSecondFactor,
  type AuthUser,
} from "../auth/middleware"
import { sendMail, renderWelcomeEmail } from "../mailer"
import { ensureDefaultOrganizationForUser } from "../services/organizations"
import {
  bootstrapSetupToken,
  clearSetupToken,
  consumeSetupToken,
  validateSetupToken,
} from "../auth/setup-token"
import {
  saveTotpSecret,
  getTotpSecret,
  markTotpVerified,
  deleteTotpSecret,
} from "../auth/totp-storage"
import { generateSecret, buildOtpauthUrl, verifyCode } from "../auth/totp"
import {
  clearTotpVerificationFailures,
  recordTotpVerificationFailure,
  requireTotpVerified,
} from "../auth/second-factor"
// AuthenticatorTransportFuture is re-exported from @simplewebauthn/server internals
// We use a simple string type alias to avoid the missing @simplewebauthn/types package
type AuthenticatorTransportFuture =
  | "ble"
  | "cable"
  | "hybrid"
  | "internal"
  | "nfc"
  | "smart-card"
  | "usb"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isSecure = shouldUseSecureCookies()
const PENDING_SETUP_TTL_MS = 30 * 60 * 1000
const PASSWORD_LOGIN_LIMIT = 10
const PASSWORD_LOGIN_WINDOW_MS = 5 * 60 * 1000

interface PendingSetupAdmin {
  email: string
  displayName: string
  createdAt: number
}

const pendingSetupAdmins = new Map<string, PendingSetupAdmin>()
const passwordLoginAttempts = new Map<
  string,
  { count: number; resetAt: number }
>()

function setCookies(
  headers: Headers,
  accessToken: string,
  refreshToken: string,
  sessionId: string
): void {
  headers.append(
    "Set-Cookie",
    buildCookieStr(ACCESS_COOKIE, accessToken, ACCESS_MAX_AGE, isSecure)
  )
  const refreshValue = `${sessionId}:${refreshToken}`
  headers.append(
    "Set-Cookie",
    buildCookieStr(REFRESH_COOKIE, refreshValue, REFRESH_MAX_AGE, isSecure)
  )
}

function clearCookies(headers: Headers): void {
  headers.append("Set-Cookie", buildCookieStr(ACCESS_COOKIE, "", 0, isSecure))
  headers.append("Set-Cookie", buildCookieStr(REFRESH_COOKIE, "", 0, isSecure))
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=")
    if (idx === -1) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    out[k] = decodeURIComponent(v)
  }
  return out
}

function getClientInfo(req: Request): { userAgent: string; ip: string } {
  return {
    userAgent: req.headers.get("user-agent") ?? "unknown",
    ip: req.headers.get("x-forwarded-for") ?? "unknown",
  }
}

function cleanupPendingSetupAdmins(): void {
  const now = Date.now()
  for (const [userId, pending] of pendingSetupAdmins) {
    if (now - pending.createdAt > PENDING_SETUP_TTL_MS) {
      pendingSetupAdmins.delete(userId)
    }
  }
}

function checkPasswordLoginRateLimit(ip: string, email: string): boolean {
  const key = `${ip}:${email}`
  const now = Date.now()
  const current = passwordLoginAttempts.get(key)
  if (!current || current.resetAt <= now) {
    passwordLoginAttempts.set(key, {
      count: 1,
      resetAt: now + PASSWORD_LOGIN_WINDOW_MS,
    })
    return true
  }
  current.count += 1
  return current.count <= PASSWORD_LOGIN_LIMIT
}

function clearPasswordLoginRateLimit(ip: string, email: string): void {
  passwordLoginAttempts.delete(`${ip}:${email}`)
}

async function getUserMeta(db: Db, userId: string) {
  const passkeyRows = await db
    .select({ id: passkeys.id })
    .from(passkeys)
    .where(eq(passkeys.user_id, userId))
  const passkeyCount = passkeyRows.length
  const backupCount = await BackupCodes.countActive(db, userId)
  const totpRows = await db
    .select({ verified_at: totp_secrets.verified_at })
    .from(totp_secrets)
    .where(eq(totp_secrets.user_id, userId))
    .limit(1)
  const hasTotp = Boolean(totpRows[0]?.verified_at)
  const userRows = await db
    .select({
      require_totp_for_secret_reveal: users.require_totp_for_secret_reveal,
      is_instance_admin: users.is_instance_admin,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return {
    has_passkey_plus: passkeyCount >= 2,
    has_backup_codes: backupCount >= 1,
    has_totp: hasTotp,
    require_totp_for_secret_reveal:
      userRows[0]?.require_totp_for_secret_reveal ?? true,
    needs_second_factor: passkeyCount < 2 && backupCount < 1 && !hasTotp,
    is_instance_admin: userRows[0]?.is_instance_admin ?? false,
  }
}

// Cast to bypass Hono's strict context variable typing without a full typed app
// (app.ts sets up the Hono instance; routes receive generic Context)
function getUser(c: { get: (key: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createAuthRouter(db: Db): Hono {
  const auth = new Hono()

  // -------------------------------------------------------------------------
  // GET /auth/instance-state
  // Public probe consumed by the frontend public-route guard. Tells the UI
  // whether the instance still needs to be bootstrapped (no users yet) so it
  // can route the visitor to /setup or /login accordingly.
  // -------------------------------------------------------------------------
  auth.get("/auth/instance-state", async (c) => {
    const userRow = await db.select({ id: users.id }).from(users).limit(1)
    const bootstrapped = userRow.length > 0
    // Lazy-bootstrap: if the DB is empty and no token is currently active
    // (e.g. the API was running before `make db-reset` so the boot probe saw a
    // non-empty DB), regenerate one now. The banner hits the API logs the
    // moment a human opens /setup, so the operator never has to time the
    // restart of `make dev` against the wipe.
    if (!bootstrapped) {
      await bootstrapSetupToken(db)
    }
    return c.json({
      bootstrapped,
      setup_token_required: env.PLOYDOK_SETUP_TOKEN_REQUIRED,
    })
  })

  // -------------------------------------------------------------------------
  // POST /auth/setup/password
  // First-boot wizard: creates the first admin with a password so bootstrap can
  // run over plain HTTP behind an IP allowlist. Passkeys remain available after
  // login, when the instance has a trusted HTTPS origin.
  // -------------------------------------------------------------------------
  auth.post("/auth/setup/password", async (c) => {
    const body = await c.req
      .json<{
        token?: string
        email?: string
        display_name?: string
        password?: string
      }>()
      .catch(
        () =>
          ({}) as {
            token?: string
            email?: string
            display_name?: string
            password?: string
          }
      )

    const existingUser = await db.select({ id: users.id }).from(users).limit(1)
    if (existingUser.length > 0) {
      clearSetupToken()
      return c.json(
        {
          error: {
            code: "ALREADY_BOOTSTRAPPED",
            message: "Instance already bootstrapped",
          },
        },
        409
      )
    }

    const email = body.email?.trim().toLowerCase()
    const displayName = body.display_name?.trim()
    const password = body.password ?? ""
    if (!email || !displayName || !password) {
      return c.json(
        {
          error: {
            code: "BAD_REQUEST",
            message: "email, display_name and password required",
          },
        },
        400
      )
    }

    const passwordError = validateAdminPassword(password)
    if (passwordError) {
      return c.json(
        { error: { code: "PASSWORD_POLICY", message: passwordError } },
        400
      )
    }

    if (env.PLOYDOK_SETUP_TOKEN_REQUIRED && !consumeSetupToken(body.token)) {
      return c.json(
        {
          error: {
            code: "SETUP_TOKEN_INVALID",
            message: "Setup token missing, expired, or already consumed",
          },
        },
        403
      )
    }

    const now = new Date()
    const user = {
      id: nanoid(),
      email,
      display_name: displayName,
    }
    const passwordHash = await hashPassword(password)

    const created = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('ploydok:first-admin'))`
      )
      const concurrentUser = await tx
        .select({ id: users.id })
        .from(users)
        .limit(1)
      if (concurrentUser.length > 0) return false
      await tx.insert(users).values({
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        password_hash: passwordHash,
        is_instance_admin: true,
        created_at: now,
        updated_at: now,
        recovery_token_hash: null,
        recovery_expires_at: null,
      })
      return true
    })
    if (!created) {
      clearSetupToken()
      return c.json(
        {
          error: {
            code: "ALREADY_BOOTSTRAPPED",
            message: "Instance already bootstrapped",
          },
        },
        409
      )
    }

    await ensureDefaultOrganizationForUser(db, user.id, user.display_name)
    const backupCodes = await BackupCodes.generate(db, user.id)

    const { userAgent, ip } = getClientInfo(c.req.raw)
    const { sessionId, refreshToken } = await Sessions.createSession(db, {
      userId: user.id,
      userAgent,
      ip,
    })
    const accessToken = await signAccessToken({
      userId: user.id,
      email: user.email,
      sessionId,
    })
    const accessExpiresAt = getAccessExpiresAt()

    clearSetupToken()

    const mail = renderWelcomeEmail(user.display_name)
    void sendMail({ to: user.email, ...mail })

    const response = c.newResponse(
      JSON.stringify({
        user: {
          id: user.id,
          email: user.email,
          display_name: user.display_name,
        },
        accessExpiresAt,
        backup_codes: backupCodes,
      }),
      200,
      { "Content-Type": "application/json" }
    )
    setCookies(response.headers, accessToken, refreshToken, sessionId)
    return response
  })

  // -------------------------------------------------------------------------
  // POST /auth/setup/options
  // First-boot wizard step 1: validates the setup token and returns WebAuthn
  // registration options so the browser can mint the first passkey. The admin
  // user is only persisted in /auth/setup/verify after attestation succeeds;
  // otherwise an interrupted WebAuthn prompt would leave the instance marked as
  // bootstrapped with no usable login method.
  // -------------------------------------------------------------------------
  auth.post("/auth/setup/options", async (c) => {
    const body = await c.req
      .json<{ token?: string; email?: string; display_name?: string }>()
      .catch(
        () => ({}) as { token?: string; email?: string; display_name?: string }
      )

    const email = body.email?.trim().toLowerCase()
    const displayName = body.display_name?.trim()
    if (!email || !displayName) {
      return c.json(
        {
          error: {
            code: "BAD_REQUEST",
            message: "email and display_name required",
          },
        },
        400
      )
    }

    if (!validateSetupToken(body.token)) {
      return c.json(
        {
          error: {
            code: "SETUP_TOKEN_INVALID",
            message: "Setup token missing, expired, or already consumed",
          },
        },
        403
      )
    }

    const existingUser = await db.select({ id: users.id }).from(users).limit(1)
    if (existingUser.length > 0) {
      clearSetupToken()
      return c.json(
        {
          error: {
            code: "ALREADY_BOOTSTRAPPED",
            message: "Instance already bootstrapped",
          },
        },
        409
      )
    }

    const userId = nanoid()
    cleanupPendingSetupAdmins()
    pendingSetupAdmins.set(userId, {
      email,
      displayName,
      createdAt: Date.now(),
    })

    const options = await generateRegOptions({
      userName: email,
      userDisplayName: displayName,
      userID: new TextEncoder().encode(userId),
      excludeCredentials: [],
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    })

    setChallenge(`setup:${userId}`, options.challenge)

    return c.json({ options, userId })
  })

  // -------------------------------------------------------------------------
  // POST /auth/setup/verify
  // First-boot wizard step 2: completes the WebAuthn ceremony, mints backup
  // codes (returned plaintext one-shot), opens an authenticated session and
  // wipes the setup token.
  // -------------------------------------------------------------------------
  auth.post("/auth/setup/verify", async (c) => {
    const body = (await c.req.json()) as {
      userId?: string
      credential?: unknown
      device_name?: string
    }

    if (!body.userId) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "userId required" } },
        400
      )
    }

    cleanupPendingSetupAdmins()
    const pendingAdmin = pendingSetupAdmins.get(body.userId)
    if (!pendingAdmin) {
      return c.json(
        {
          error: {
            code: "SETUP_CHALLENGE_EXPIRED",
            message: "Setup challenge expired. Reload setup and try again.",
          },
        },
        400
      )
    }

    const expectedChallenge = consumeChallenge(`setup:${body.userId}`)
    if (!expectedChallenge) {
      pendingSetupAdmins.delete(body.userId)
      return c.json(
        {
          error: {
            code: "CHALLENGE_EXPIRED",
            message: "Challenge expired or not found",
          },
        },
        400
      )
    }

    let verification
    try {
      verification = await verifyRegResponse({
        response: body.credential as Parameters<
          typeof verifyRegResponse
        >[0]["response"],
        expectedChallenge,
      })
    } catch (err) {
      pendingSetupAdmins.delete(body.userId)
      return c.json(
        { error: { code: "VERIFICATION_FAILED", message: String(err) } },
        400
      )
    }

    if (!verification.verified || !verification.registrationInfo) {
      pendingSetupAdmins.delete(body.userId)
      return c.json(
        {
          error: {
            code: "VERIFICATION_FAILED",
            message: "Attestation not verified",
          },
        },
        400
      )
    }

    const existingUser = await db.select({ id: users.id }).from(users).limit(1)
    if (existingUser.length > 0) {
      pendingSetupAdmins.delete(body.userId)
      clearSetupToken()
      return c.json(
        {
          error: {
            code: "ALREADY_BOOTSTRAPPED",
            message: "Instance already bootstrapped",
          },
        },
        409
      )
    }

    const { credential } = verification.registrationInfo
    const now = new Date()
    const user = {
      id: body.userId,
      email: pendingAdmin.email,
      display_name: pendingAdmin.displayName,
    }

    const created = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('ploydok:first-admin'))`
      )
      const concurrentUser = await tx
        .select({ id: users.id })
        .from(users)
        .limit(1)
      if (concurrentUser.length > 0) return false

      await tx.insert(users).values({
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        is_instance_admin: true,
        created_at: now,
        updated_at: now,
        recovery_token_hash: null,
        recovery_expires_at: null,
      })

      await tx.insert(passkeys).values({
        id: nanoid(),
        user_id: user.id,
        credential_id: credential.id,
        public_key: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: JSON.stringify(credential.transports ?? []),
        device_name: body.device_name?.trim() || null,
        created_at: now,
        last_used_at: now,
      })
      return true
    })

    if (!created) {
      pendingSetupAdmins.delete(body.userId)
      clearSetupToken()
      return c.json(
        {
          error: {
            code: "ALREADY_BOOTSTRAPPED",
            message: "Instance already bootstrapped",
          },
        },
        409
      )
    }

    pendingSetupAdmins.delete(body.userId)

    await ensureDefaultOrganizationForUser(db, user.id, user.display_name)
    const backupCodes = await BackupCodes.generate(db, user.id)

    const { userAgent, ip } = getClientInfo(c.req.raw)
    const { sessionId, refreshToken } = await Sessions.createSession(db, {
      userId: user.id,
      userAgent,
      ip,
    })
    const accessToken = await signAccessToken({
      userId: user.id,
      email: user.email,
      sessionId,
    })

    clearSetupToken()

    const mail = renderWelcomeEmail(user.display_name)
    void sendMail({ to: user.email, ...mail })

    const response = c.newResponse(
      JSON.stringify({
        user: {
          id: user.id,
          email: user.email,
          display_name: user.display_name,
        },
        backup_codes: backupCodes,
      }),
      200,
      { "Content-Type": "application/json" }
    )
    setCookies(response.headers, accessToken, refreshToken, sessionId)
    return response
  })

  // -------------------------------------------------------------------------
  // POST /auth/register/options
  // Adds a passkey to the currently authenticated user (e.g. invitation
  // accept flow, second-device enrollment). First-boot bootstrap goes through
  // /auth/setup/* instead.
  // -------------------------------------------------------------------------
  auth.post("/auth/register/options", requireAuth(db), async (c) => {
    const user = getUser(c)

    // Get existing credentials to exclude them
    const existingPasskeys = await db
      .select({
        credential_id: passkeys.credential_id,
        transports: passkeys.transports,
      })
      .from(passkeys)
      .where(eq(passkeys.user_id, user.id))

    const excludeCredentials = existingPasskeys.map((pk) => ({
      id: pk.credential_id,
      type: "public-key" as const,
      transports: JSON.parse(pk.transports) as AuthenticatorTransportFuture[],
    }))

    const options = await generateRegOptions({
      userName: user.email,
      userDisplayName: user.display_name,
      userID: new TextEncoder().encode(user.id),
      excludeCredentials,
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    })

    setChallenge(`reg:${user.id}`, options.challenge)

    return c.json({ options, userId: user.id })
  })

  // -------------------------------------------------------------------------
  // POST /auth/register/verify
  // -------------------------------------------------------------------------
  auth.post("/auth/register/verify", requireAuth(db), async (c) => {
    const authUser = getUser(c)
    const body = (await c.req.json()) as {
      userId: string
      credential: unknown
      device_name?: string
    }

    if (!body.userId) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "userId required" } },
        400
      )
    }

    if (body.userId !== authUser.id) {
      return c.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Cannot enroll a passkey for another user",
          },
        },
        403
      )
    }

    const expectedChallenge = consumeChallenge(`reg:${body.userId}`)
    if (!expectedChallenge) {
      return c.json(
        {
          error: {
            code: "CHALLENGE_EXPIRED",
            message: "Challenge expired or not found",
          },
        },
        400
      )
    }

    let verification
    try {
      verification = await verifyRegResponse({
        response: body.credential as Parameters<
          typeof verifyRegResponse
        >[0]["response"],
        expectedChallenge,
      })
    } catch (err) {
      return c.json(
        { error: { code: "VERIFICATION_FAILED", message: String(err) } },
        400
      )
    }

    if (!verification.verified || !verification.registrationInfo) {
      return c.json(
        {
          error: {
            code: "VERIFICATION_FAILED",
            message: "Attestation not verified",
          },
        },
        400
      )
    }

    const { credential } = verification.registrationInfo

    const now = new Date()
    await db.insert(passkeys).values({
      id: nanoid(),
      user_id: body.userId,
      credential_id: credential.id,
      public_key: Buffer.from(credential.publicKey),
      counter: credential.counter,
      transports: JSON.stringify(credential.transports ?? []),
      device_name: body.device_name ?? null,
      created_at: now,
      last_used_at: now,
    })

    const { userAgent, ip } = getClientInfo(c.req.raw)
    const { sessionId, refreshToken } = await Sessions.createSession(db, {
      userId: body.userId,
      userAgent,
      ip,
    })

    const accessToken = await signAccessToken({
      userId: body.userId,
      email: authUser.email,
      sessionId,
    })

    const meta = await getUserMeta(db, body.userId)

    // Welcome email sur la première passkey (meta.has_passkey_plus === false + on vient d'insérer).
    const totalPasskeys = await db
      .select({ id: passkeys.id })
      .from(passkeys)
      .where(eq(passkeys.user_id, body.userId))
    if (totalPasskeys.length === 1) {
      const mail = renderWelcomeEmail(authUser.display_name)
      void sendMail({ to: authUser.email, ...mail })
    }

    const response = c.newResponse(
      JSON.stringify({
        user: {
          id: authUser.id,
          email: authUser.email,
          display_name: authUser.display_name,
        },
        ...meta,
      }),
      200,
      { "Content-Type": "application/json" }
    )
    setCookies(response.headers, accessToken, refreshToken, sessionId)
    return response
  })

  // -------------------------------------------------------------------------
  // POST /auth/login/password
  // -------------------------------------------------------------------------
  auth.post("/auth/login/password", async (c) => {
    const body = await c.req
      .json<{ email?: string; password?: string }>()
      .catch(() => ({}) as { email?: string; password?: string })

    const email = body.email?.trim().toLowerCase()
    const password = body.password ?? ""
    if (!email || !password) {
      return c.json(
        {
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Invalid email or password",
          },
        },
        401
      )
    }

    const { userAgent, ip } = getClientInfo(c.req.raw)
    if (!checkPasswordLoginRateLimit(ip, email)) {
      return c.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: "Too many login attempts. Try again in a few minutes.",
          },
        },
        429
      )
    }

    const userRows = await db
      .select({
        id: users.id,
        email: users.email,
        display_name: users.display_name,
        password_hash: users.password_hash,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
    const user = userRows[0]

    const verified =
      user?.password_hash &&
      (await verifyPassword(password, user.password_hash))

    if (!user || !verified) {
      return c.json(
        {
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Invalid email or password",
          },
        },
        401
      )
    }

    clearPasswordLoginRateLimit(ip, email)

    const { sessionId, refreshToken } = await Sessions.createSession(db, {
      userId: user.id,
      userAgent,
      ip,
    })

    const accessToken = await signAccessToken({
      userId: user.id,
      email: user.email,
      sessionId,
    })
    const accessExpiresAt = getAccessExpiresAt()
    const meta = await getUserMeta(db, user.id)

    const response = c.newResponse(
      JSON.stringify({
        user: {
          id: user.id,
          email: user.email,
          display_name: user.display_name,
        },
        accessExpiresAt,
        ...meta,
      }),
      200,
      { "Content-Type": "application/json" }
    )
    setCookies(response.headers, accessToken, refreshToken, sessionId)
    return response
  })

  // -------------------------------------------------------------------------
  // GET /auth/login/options
  // -------------------------------------------------------------------------
  auth.get("/auth/login/options", async (c) => {
    const email = c.req.query("email")?.trim().toLowerCase()

    let userId: string | undefined

    if (email) {
      const userRows = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1)
      const user = userRows[0]
      if (!user) {
        return c.json(
          {
            error: {
              code: "PASSKEY_NOT_FOUND",
              message: "No passkey is registered for this email",
            },
          },
          404
        )
      }
      userId = user.id
    }

    let options
    if (userId) {
      const userPasskeys = await db
        .select({
          credential_id: passkeys.credential_id,
          transports: passkeys.transports,
        })
        .from(passkeys)
        .where(eq(passkeys.user_id, userId))

      const allowCredentials = userPasskeys.map((pk) => ({
        id: pk.credential_id,
        type: "public-key" as const,
        transports: JSON.parse(pk.transports) as AuthenticatorTransportFuture[],
      }))

      if (allowCredentials.length === 0) {
        return c.json(
          {
            error: {
              code: "PASSKEY_NOT_FOUND",
              message: "No passkey is registered for this email",
            },
          },
          404
        )
      }

      options = await generateAuthOptions({
        allowCredentials,
        userVerification: "required",
      })
    } else {
      // Usernameless or user not found — don't reveal non-existence
      options = await generateAuthOptions({ userVerification: "required" })
    }

    const challengeKey = userId
      ? `auth:${userId}`
      : `auth:anon:${options.challenge.slice(0, 16)}`
    setChallenge(challengeKey, options.challenge)

    return c.json({ options, _challengeKey: challengeKey })
  })

  // -------------------------------------------------------------------------
  // POST /auth/login/verify
  // -------------------------------------------------------------------------
  auth.post("/auth/login/verify", async (c) => {
    const body = (await c.req.json()) as {
      credential: { id: string }
      _challengeKey: string
    }

    if (!body._challengeKey) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "_challengeKey required" } },
        400
      )
    }

    const expectedChallenge = consumeChallenge(body._challengeKey)
    if (!expectedChallenge) {
      return c.json(
        {
          error: {
            code: "CHALLENGE_EXPIRED",
            message: "Challenge expired or not found",
          },
        },
        400
      )
    }

    const passkeyRows = await db
      .select()
      .from(passkeys)
      .where(eq(passkeys.credential_id, body.credential.id))
      .limit(1)

    const passkey = passkeyRows[0]
    if (!passkey) {
      return c.json(
        {
          error: {
            code: "PASSKEY_NOT_REGISTERED",
            message:
              "This browser passkey is not registered in the current Ploydok database",
          },
        },
        401
      )
    }

    let verification
    try {
      verification = await verifyAuthResponse({
        response: body.credential as Parameters<
          typeof verifyAuthResponse
        >[0]["response"],
        expectedChallenge,
        credential: {
          id: passkey.credential_id,
          publicKey: new Uint8Array(passkey.public_key),
          counter: passkey.counter,
          transports: JSON.parse(
            passkey.transports
          ) as AuthenticatorTransportFuture[],
        },
        requireUserVerification: true,
      })
    } catch (err) {
      return c.json(
        { error: { code: "VERIFICATION_FAILED", message: String(err) } },
        400
      )
    }

    if (!verification.verified) {
      return c.json(
        {
          error: {
            code: "VERIFICATION_FAILED",
            message: "Assertion not verified",
          },
        },
        400
      )
    }

    await db
      .update(passkeys)
      .set({
        counter: verification.authenticationInfo.newCounter,
        last_used_at: new Date(),
      })
      .where(eq(passkeys.id, passkey.id))

    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.id, passkey.user_id))
      .limit(1)
    const user = userRows[0]
    if (!user) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "User not found" } },
        404
      )
    }

    const { userAgent, ip } = getClientInfo(c.req.raw)
    const { sessionId, refreshToken } = await Sessions.createSession(db, {
      userId: user.id,
      userAgent,
      ip,
    })

    const accessToken = await signAccessToken({
      userId: user.id,
      email: user.email,
      sessionId,
    })
    const accessExpiresAt = getAccessExpiresAt()

    const meta = await getUserMeta(db, user.id)

    const response = c.newResponse(
      JSON.stringify({
        user: {
          id: user.id,
          email: user.email,
          display_name: user.display_name,
        },
        accessExpiresAt,
        ...meta,
      }),
      200,
      { "Content-Type": "application/json" }
    )
    setCookies(response.headers, accessToken, refreshToken, sessionId)
    return response
  })

  // -------------------------------------------------------------------------
  // POST /auth/logout
  // -------------------------------------------------------------------------
  auth.post("/auth/logout", requireAuth(db), async (c) => {
    const user = getUser(c)
    await Sessions.revokeSession(db, user.session_id)
    const response = c.newResponse(null, 204)
    clearCookies(response.headers)
    return response
  })

  // -------------------------------------------------------------------------
  // POST /auth/refresh
  // -------------------------------------------------------------------------
  auth.post("/auth/refresh", async (c) => {
    const cookieHeader = c.req.raw.headers.get("cookie") ?? ""
    const cookies = parseCookies(cookieHeader)
    const refreshCookie = cookies[REFRESH_COOKIE]

    if (!refreshCookie) {
      return c.json(
        { error: { code: "UNAUTHENTICATED", message: "No refresh token" } },
        401
      )
    }

    const colonIdx = refreshCookie.indexOf(":")
    if (colonIdx === -1) {
      return c.json(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "Invalid refresh token format",
          },
        },
        401
      )
    }
    const sessionId = refreshCookie.slice(0, colonIdx)
    const rawToken = refreshCookie.slice(colonIdx + 1)

    const rejectReplay = async () => {
      await Sessions.revokeSessionFamily(db, sessionId)
      return c.json(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "Invalid or expired refresh token",
          },
        },
        401
      )
    }

    const rejectConcurrentRotation = () =>
      c.json(
        {
          error: {
            code: "REFRESH_CONFLICT",
            message: "Refresh token was rotated by another request",
          },
        },
        409
      )

    const session = await Sessions.verifyRefreshToken(db, sessionId, rawToken)
    if (!session) {
      const currentRows = await db
        .select({
          rotated_at: sessionsTable.rotated_at,
          revoked_at: sessionsTable.revoked_at,
        })
        .from(sessionsTable)
        .where(eq(sessionsTable.id, sessionId))
        .limit(1)
      const current = currentRows[0]
      if (
        current?.revoked_at === null &&
        current.rotated_at !== null &&
        Date.now() - current.rotated_at.getTime() < 10_000
      ) {
        return rejectConcurrentRotation()
      }
      return rejectReplay()
    }

    const newRefreshToken = await Sessions.rotateRefreshToken(
      db,
      sessionId,
      session.refresh_token_hash
    )
    if (!newRefreshToken) {
      return rejectConcurrentRotation()
    }

    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.id, session.user_id))
      .limit(1)
    const user = userRows[0]
    if (!user) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "User not found" } },
        404
      )
    }

    const accessToken = await signAccessToken({
      userId: user.id,
      email: user.email,
      sessionId,
    })
    const accessExpiresAt = getAccessExpiresAt()

    const response = c.newResponse(
      JSON.stringify({ ok: true, accessExpiresAt }),
      200,
      { "Content-Type": "application/json" }
    )
    setCookies(response.headers, accessToken, newRefreshToken, sessionId)
    return response
  })

  // -------------------------------------------------------------------------
  // POST /auth/backup-codes/consume
  // -------------------------------------------------------------------------
  auth.post("/auth/backup-codes/consume", async (c) => {
    const body = (await c.req.json()) as { email: string; code: string }
    if (!body.email || !body.code) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "email and code required" } },
        400
      )
    }

    const email = body.email.trim().toLowerCase()
    const { userAgent, ip } = getClientInfo(c.req.raw)
    if (!checkPasswordLoginRateLimit(ip, email)) {
      return c.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: "Too many authentication attempts. Try again later.",
          },
        },
        429
      )
    }

    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
    const user = userRows[0]
    if (!user) {
      return c.json(
        { error: { code: "INVALID_CODE", message: "Invalid backup code" } },
        401
      )
    }

    const ok = await BackupCodes.consume(
      db,
      user.id,
      body.code.trim().toUpperCase()
    )
    if (!ok) {
      return c.json(
        {
          error: {
            code: "INVALID_CODE",
            message: "Invalid or already used backup code",
          },
        },
        401
      )
    }

    clearPasswordLoginRateLimit(ip, email)
    const { sessionId, refreshToken } = await Sessions.createSession(db, {
      userId: user.id,
      userAgent,
      ip,
    })

    const accessToken = await signAccessToken({
      userId: user.id,
      email: user.email,
      sessionId,
    })
    const accessExpiresAt = getAccessExpiresAt()
    const meta = await getUserMeta(db, user.id)

    const response = c.newResponse(
      JSON.stringify({
        user: {
          id: user.id,
          email: user.email,
          display_name: user.display_name,
        },
        accessExpiresAt,
        ...meta,
      }),
      200,
      { "Content-Type": "application/json" }
    )
    setCookies(response.headers, accessToken, refreshToken, sessionId)
    return response
  })

  // -------------------------------------------------------------------------
  // GET /auth/passkeys
  // -------------------------------------------------------------------------
  auth.get("/auth/passkeys", requireAuth(db), async (c) => {
    const user = getUser(c)
    const rows = await db
      .select({
        id: passkeys.id,
        credential_id: passkeys.credential_id,
        device_name: passkeys.device_name,
        created_at: passkeys.created_at,
        last_used_at: passkeys.last_used_at,
      })
      .from(passkeys)
      .where(eq(passkeys.user_id, user.id))

    return c.json({
      passkeys: rows.map((pk) => ({
        id: pk.id,
        credential_id: pk.credential_id,
        device_name: pk.device_name,
        created_at: pk.created_at?.toISOString(),
        last_used_at: pk.last_used_at?.toISOString(),
      })),
    })
  })

  // -------------------------------------------------------------------------
  // DELETE /auth/passkeys/:id
  // -------------------------------------------------------------------------
  auth.delete("/auth/passkeys/:id", requireAuth(db), async (c) => {
    const user = getUser(c)
    const passkeyId = c.req.param("id") ?? ""

    if (!passkeyId) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "id required" } },
        400
      )
    }

    const target = await db
      .select()
      .from(passkeys)
      .where(and(eq(passkeys.id, passkeyId), eq(passkeys.user_id, user.id)))
      .limit(1)

    if (!target[0]) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Passkey not found" } },
        404
      )
    }

    const allPasskeys = await db
      .select({ id: passkeys.id })
      .from(passkeys)
      .where(eq(passkeys.user_id, user.id))

    if (allPasskeys.length <= 1) {
      const backupCount = await BackupCodes.countActive(db, user.id)
      if (backupCount < 1) {
        return c.json(
          {
            error: {
              code: "CANNOT_DELETE_LAST_PASSKEY",
              message:
                "Cannot delete the last passkey without active backup codes",
            },
          },
          409
        )
      }
    }

    await db.delete(passkeys).where(eq(passkeys.id, passkeyId))
    return c.newResponse(null, 204)
  })

  // -------------------------------------------------------------------------
  // GET /auth/sessions
  // -------------------------------------------------------------------------
  auth.get("/auth/sessions", requireAuth(db), async (c) => {
    const user = getUser(c)
    const sessionList = await Sessions.listSessions(db, user.id)

    return c.json({
      sessions: sessionList.map((s) => ({
        id: s.id,
        user_agent: s.user_agent,
        ip: s.ip,
        created_at: s.created_at?.toISOString(),
        last_seen_at: s.last_seen_at?.toISOString(),
        expires_at: s.expires_at?.toISOString(),
        is_current: s.id === user.session_id,
      })),
    })
  })

  // -------------------------------------------------------------------------
  // DELETE /auth/sessions/:id
  // -------------------------------------------------------------------------
  auth.delete("/auth/sessions/:id", requireAuth(db), async (c) => {
    const user = getUser(c)
    const targetId = c.req.param("id") ?? ""

    if (!targetId) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "id required" } },
        400
      )
    }

    if (targetId === user.session_id) {
      return c.json(
        {
          error: {
            code: "CANNOT_REVOKE_CURRENT",
            message: "Use /auth/logout to end current session",
          },
        },
        409
      )
    }

    const rows = await db
      .select({ id: sessionsTable.id, user_id: sessionsTable.user_id })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, targetId))
      .limit(1)

    const sessionRow = rows[0]
    if (!sessionRow || sessionRow.user_id !== user.id) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Session not found" } },
        404
      )
    }

    await Sessions.revokeSession(db, targetId)
    return c.newResponse(null, 204)
  })

  // -------------------------------------------------------------------------
  // POST /auth/sessions/revoke-others
  // -------------------------------------------------------------------------
  auth.post("/auth/sessions/revoke-others", requireAuth(db), async (c) => {
    const user = getUser(c)
    await Sessions.revokeOtherSessions(db, user.id, user.session_id)
    return c.json({ ok: true })
  })

  // -------------------------------------------------------------------------
  // POST /auth/totp/enroll
  // -------------------------------------------------------------------------
  auth.post("/auth/totp/enroll", requireAuth(db), async (c) => {
    const user = getUser(c)

    const existing = await getTotpSecret(db, user.id)
    if (existing?.verifiedAt) {
      return c.json(
        {
          error: {
            code: "TOTP_ALREADY_ENROLLED",
            message: "TOTP is already enrolled and verified",
          },
        },
        409
      )
    }

    const secret = generateSecret()
    await saveTotpSecret(db, user.id, secret)

    const otpauthUrl = buildOtpauthUrl({
      secret,
      issuer: "Ploydok",
      accountName: user.email,
    })

    return c.json({ secret, otpauthUrl })
  })

  // -------------------------------------------------------------------------
  // POST /auth/totp/verify
  // -------------------------------------------------------------------------
  auth.post("/auth/totp/verify", requireAuth(db), async (c) => {
    const user = getUser(c)
    const body = await c.req
      .json<{ code?: string }>()
      .catch(() => ({}) as { code?: string })

    const totpRow = await getTotpSecret(db, user.id)
    if (!totpRow) {
      return c.json(
        { error: { code: "TOTP_NOT_ENROLLED", message: "TOTP not enrolled" } },
        404
      )
    }
    if (totpRow.verifiedAt) {
      return c.json(
        {
          error: {
            code: "TOTP_ALREADY_ENROLLED",
            message: "TOTP is already verified",
          },
        },
        409
      )
    }

    const code = String(body.code ?? "")
    if (!verifyCode(totpRow.secret, code, { window: 1 })) {
      const throttle = await recordTotpVerificationFailure(
        db,
        user.id,
        "enrollment"
      )
      if (throttle.locked) {
        c.header("Retry-After", String(throttle.retryAfterSec))
        return c.json(
          {
            error: {
              code: "TOTP_LOCKED",
              message: "Too many invalid TOTP attempts. Try again later.",
            },
          },
          429
        )
      }

      return c.json(
        { error: { code: "INVALID_CODE", message: "Invalid TOTP code" } },
        400
      )
    }

    await markTotpVerified(db, user.id)
    clearTotpVerificationFailures(user.id)
    return c.json({ ok: true })
  })

  // -------------------------------------------------------------------------
  // POST /auth/second-factor/verify
  // -------------------------------------------------------------------------
  auth.post(
    "/auth/second-factor/verify",
    requireAuth(db),
    requireTotpVerified(db),
    (c) => c.json({ ok: true })
  )

  // -------------------------------------------------------------------------
  // PATCH /auth/totp/preferences
  // -------------------------------------------------------------------------
  auth.patch("/auth/totp/preferences", requireAuth(db), async (c) => {
    const user = getUser(c)
    const body = await c.req
      .json<{ requireTotpForSecretReveal?: unknown }>()
      .catch(() => ({}) as { requireTotpForSecretReveal?: unknown })

    if (typeof body.requireTotpForSecretReveal !== "boolean") {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "requireTotpForSecretReveal must be a boolean",
          },
        },
        400
      )
    }

    await db
      .update(users)
      .set({
        require_totp_for_secret_reveal: body.requireTotpForSecretReveal,
        updated_at: new Date(),
      })
      .where(eq(users.id, user.id))

    return c.json({
      require_totp_for_secret_reveal: body.requireTotpForSecretReveal,
    })
  })

  // -------------------------------------------------------------------------
  // DELETE /auth/totp
  // -------------------------------------------------------------------------
  auth.delete(
    "/auth/totp",
    requireAuth(db),
    requireSecondFactor(db),
    async (c) => {
      const user = getUser(c)
      await deleteTotpSecret(db, user.id)
      return c.newResponse(null, 204)
    }
  )

  // -------------------------------------------------------------------------
  // POST /auth/dev-login — bypass WebAuthn for Playwright / local e2e.
  // Guarded HARD by NODE_ENV !== "prod". Bound to loopback via Origin check.
  // Picks the first user if no email is given. Issues real access+refresh
  // cookies so the rest of the app behaves identically.
  // -------------------------------------------------------------------------
  auth.post("/auth/dev-login", async (c) => {
    if (env.NODE_ENV === "prod") {
      return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404)
    }
    const origin = c.req.header("origin") ?? ""
    const host = c.req.header("host") ?? ""
    const loopbackRe = /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?$/
    if (
      origin &&
      !loopbackRe.test(origin) &&
      !loopbackRe.test(`http://${host}`)
    ) {
      return c.json(
        { error: { code: "FORBIDDEN", message: "dev-login is loopback-only" } },
        403
      )
    }

    let body: { email?: string } = {}
    try {
      body = await c.req.json()
    } catch {
      // empty body is fine — we'll pick the first user
    }

    const rows = body.email
      ? await db
          .select()
          .from(users)
          .where(eq(users.email, body.email))
          .limit(1)
      : await db.select().from(users).limit(1)
    const user = rows[0]
    if (!user) {
      return c.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "No user found — seed one first",
          },
        },
        404
      )
    }

    const { userAgent, ip } = getClientInfo(c.req.raw)
    const { sessionId, refreshToken } = await Sessions.createSession(db, {
      userId: user.id,
      userAgent,
      ip,
    })
    const accessToken = await signAccessToken({
      userId: user.id,
      email: user.email,
      sessionId,
    })

    const response = c.newResponse(
      JSON.stringify({
        user: {
          id: user.id,
          email: user.email,
          display_name: user.display_name,
        },
      }),
      200,
      { "Content-Type": "application/json" }
    )
    setCookies(response.headers, accessToken, refreshToken, sessionId)
    return response
  })

  return auth
}
