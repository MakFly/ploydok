// SPDX-License-Identifier: AGPL-3.0-only

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3335"

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

export class SessionExpiredError extends ApiError {
  constructor() {
    super(401, "SESSION_EXPIRED", "Session expired, please sign in again")
    this.name = "SessionExpiredError"
  }
}

export class BackendUnavailableError extends ApiError {
  constructor(message = `Le frontend ne parvient plus a joindre l'API sur ${API_BASE}.`) {
    super(503, "BACKEND_UNAVAILABLE", message)
    this.name = "BackendUnavailableError"
  }
}

export function shouldRetryCriticalQuery(failureCount: number, error: ApiError): boolean {
  if (error.status === 401) return false
  if (error instanceof BackendUnavailableError) return failureCount < 1
  return error.status >= 500 && error.status < 600 && failureCount < 2
}

export function criticalRetryDelay(attemptIndex: number, error: ApiError): number {
  if (error instanceof BackendUnavailableError) return 150
  return Math.min(1000 * 2 ** attemptIndex, 30_000)
}

export type RefreshResult =
  | { ok: true; accessExpiresAt: number | null }
  | { ok: false; reason: "refresh_expired" | "network_error" | "server_error" }

// ---------------------------------------------------------------------------
// Module-scope state — shared in both runtimes:
//   - On the client (single user, single process): correct.
//   - On the SSR server: csrfToken/refreshPromise/getCache are not user-secret;
//     refresh is rarely contended because each beforeLoad makes ~1 /me call.
//     Per-request cookie isolation is handled by _ssrCookieOverrides below.
// ---------------------------------------------------------------------------

let _clientAccessExpiresAt: number | null = null

interface RuntimeState {
  csrfToken: string | null
  refreshPromise: Promise<RefreshResult> | null
  getCache: Map<string, Promise<unknown>>
}

function createRuntimeState(): RuntimeState {
  return {
    csrfToken: null,
    refreshPromise: null,
    getCache: new Map(),
  }
}

const _clientState = createRuntimeState()

interface AuthCallbacks {
  onTokenRefreshed?: () => void
  onLoggedOut?: () => void
  onAccessExpiryUpdate?: (expiresAt: number | null) => void
}

let _authCallbacks: AuthCallbacks = {}

export function setAuthCallbacks(cb: AuthCallbacks): void {
  _authCallbacks = cb
}

export function invalidateGetCache(path?: string): void {
  if (path) _clientState.getCache.delete(path)
  else _clientState.getCache.clear()
}

export function resetCsrfToken(): void {
  _clientState.csrfToken = null
}

export function updateAccessExpiry(expiresAt: number | null): void {
  if (typeof window === "undefined") return
  _clientAccessExpiresAt = expiresAt
  _authCallbacks.onAccessExpiryUpdate?.(expiresAt)
}

export function getAccessExpiry(): number | null {
  return _clientAccessExpiresAt
}

// ---------------------------------------------------------------------------
// SSR cookie helpers
//
// Why dynamic import of the package path instead of a static import:
//   TanStack Start's import-protection plugin bans static imports of
//   `**/*.server.*` files from anything reachable by the client entry. A
//   dynamic import of `@tanstack/react-start/server` (a package subpath that
//   resolves to `server.js`, which does not match the pattern) is fine, and
//   the `typeof window === "undefined"` guard ensures the client never
//   evaluates the import() at runtime.
// ---------------------------------------------------------------------------

const DEBUG_AUTH = typeof process !== "undefined" && !!process.env["PLOYDOK_DEBUG_AUTH"]

// Per-request cookie rotation: when /auth/refresh sets new cookies during the
// SSR cycle, the in-flight retry must use them. The incoming Cookie header is
// immutable, so we attach rotated values to the per-request Request object via
// a WeakMap. TanStack's getRequest() is per-request via H3's AsyncLocalStorage,
// so the key is stable and unique.
const _ssrOverrides: WeakMap<Request, Map<string, string>> = new WeakMap()
const _ssrState: WeakMap<Request, RuntimeState> = new WeakMap()

type ReactStartServer = typeof import("@tanstack/react-start/server")
let _serverModPromise: Promise<ReactStartServer | null> | null = null

async function getServerMod(): Promise<ReactStartServer | null> {
  if (typeof window !== "undefined") return null
  if (!_serverModPromise) {
    _serverModPromise = import("@tanstack/react-start/server").catch((e: unknown) => {
      if (DEBUG_AUTH) console.log("[ssr-auth] failed to load react-start/server:", e)
      return null
    })
  }
  return _serverModPromise
}

async function getRuntimeState(): Promise<RuntimeState> {
  if (typeof window !== "undefined") return _clientState

  const mod = await getServerMod()
  if (!mod) return createRuntimeState()

  try {
    const req = mod.getRequest()
    let state = _ssrState.get(req)
    if (!state) {
      state = createRuntimeState()
      _ssrState.set(req, state)
    }
    return state
  } catch {
    return createRuntimeState()
  }
}

async function invalidateRuntimeGetCache(path?: string): Promise<void> {
  const state = await getRuntimeState()
  if (path) state.getCache.delete(path)
  else state.getCache.clear()
}

async function buildSsrCookieHeader(): Promise<string> {
  const mod = await getServerMod()
  if (!mod) return ""

  let base: Record<string, string> = {}
  try {
    base = mod.getCookies()
  } catch (e) {
    if (DEBUG_AUTH) console.log("[ssr-auth] getCookies threw:", e)
    return ""
  }

  let overrides: Map<string, string> | undefined
  try {
    const req = mod.getRequest()
    overrides = _ssrOverrides.get(req)
  } catch {
    // outside an SSR request context — proceed with base only
  }

  const merged: Record<string, string> = {
    ...base,
    ...(overrides ? Object.fromEntries(overrides) : {}),
  }
  const parts: Array<string> = []
  for (const [k, v] of Object.entries(merged)) parts.push(`${k}=${v}`)
  const header = parts.join("; ")

  if (DEBUG_AUTH) {
    console.log(
      "[ssr-auth] buildSsrCookieHeader → names:",
      Object.keys(merged).join(",") || "(none)",
      "len:",
      header.length,
    )
  }
  return header
}

async function applySsrSetCookies(setCookies: Array<string>): Promise<void> {
  if (setCookies.length === 0) return
  const mod = await getServerMod()
  if (!mod) return

  try {
    mod.setResponseHeader("set-cookie", setCookies)
    if (DEBUG_AUTH) {
      console.log("[ssr-auth] forwarded", setCookies.length, "Set-Cookie headers to browser")
    }
  } catch (e) {
    if (DEBUG_AUTH) console.log("[ssr-auth] setResponseHeader threw:", e)
  }

  try {
    const req = mod.getRequest()
    let overrides = _ssrOverrides.get(req)
    if (!overrides) {
      overrides = new Map()
      _ssrOverrides.set(req, overrides)
    }
    for (const raw of setCookies) {
      const semi = raw.indexOf(";")
      const pair = semi === -1 ? raw : raw.slice(0, semi)
      const eq = pair.indexOf("=")
      if (eq === -1) continue
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      if (!name) continue
      if (value === "" || /\bMax-Age=0\b/i.test(raw)) overrides.delete(name)
      else overrides.set(name, value)
    }
  } catch {
    // no request context — ignore
  }
}

// ---------------------------------------------------------------------------
// CSRF
// ---------------------------------------------------------------------------

async function fetchCsrf(): Promise<string> {
  const res = await rawRequest("/auth/csrf", { method: "GET" })
  if (!res.ok) throw new Error("Failed to fetch CSRF token")
  const data = (await res.json()) as { token: string }
  const state = await getRuntimeState()
  state.csrfToken = data.token
  return data.token
}

async function getCsrfToken(): Promise<string> {
  const state = await getRuntimeState()
  if (state.csrfToken) return state.csrfToken
  return fetchCsrf()
}

// ---------------------------------------------------------------------------
// rawRequest — SSR forwards merged Cookie header (incoming + rotation overrides)
// ---------------------------------------------------------------------------

async function rawRequest(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers)
  if (typeof window === "undefined" && !headers.has("cookie")) {
    const cookieHeader = await buildSsrCookieHeader()
    if (cookieHeader) headers.set("cookie", cookieHeader)
  }
  if (typeof window === "undefined" && process.env["PLOYDOK_DEBUG_AUTH"]) {
    const ck = headers.get("cookie") ?? ""
    console.log(
      "[ssr-auth] rawRequest",
      init.method ?? "GET",
      path,
      "cookieLen:",
      ck.length,
      "hasAccess:",
      ck.includes("ploydok_access="),
      "hasRefresh:",
      ck.includes("ploydok_refresh="),
    )
  }
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include", ...init, headers })
  if (typeof window === "undefined" && process.env["PLOYDOK_DEBUG_AUTH"]) {
    console.log("[ssr-auth] rawRequest", path, "→", res.status)
  }
  return res
}

function toBackendUnavailableError(error: unknown): BackendUnavailableError {
  if (error instanceof BackendUnavailableError) return error
  return new BackendUnavailableError()
}

// ---------------------------------------------------------------------------
// refreshSession — single-flight, typed result
// ---------------------------------------------------------------------------

async function doRefresh(): Promise<RefreshResult> {
  let res: Response
  try {
    res = await rawRequest("/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })
  } catch {
    return { ok: false, reason: "network_error" }
  }
  if (!res.ok) {
    const reason: "refresh_expired" | "server_error" =
      res.status === 401 ? "refresh_expired" : "server_error"
    if (reason === "refresh_expired" && typeof window !== "undefined") {
      _clientAccessExpiresAt = null
      _authCallbacks.onLoggedOut?.()
    }
    return { ok: false, reason }
  }
  const setCookies =
    typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : []
  if (typeof window === "undefined") {
    await applySsrSetCookies(setCookies)
  }
  let accessExpiresAt: number | null = null
  try {
    const data = (await res.json()) as { accessExpiresAt?: unknown }
    if (typeof data.accessExpiresAt === "number") accessExpiresAt = data.accessExpiresAt
  } catch {
    // ignore
  }
  if (typeof window !== "undefined") {
    _clientAccessExpiresAt = accessExpiresAt
    _authCallbacks.onAccessExpiryUpdate?.(accessExpiresAt)
    _authCallbacks.onTokenRefreshed?.()
  }
  return { ok: true, accessExpiresAt }
}

async function refreshSession(): Promise<RefreshResult> {
  const state = await getRuntimeState()
  if (state.refreshPromise) return state.refreshPromise
  const promise = doRefresh()
  state.refreshPromise = promise
  void promise.finally(() => {
    if (state.refreshPromise === promise) state.refreshPromise = null
  })
  return promise
}

export async function triggerRefresh(): Promise<RefreshResult> {
  return refreshSession()
}

function isPreSessionPath(path: string): boolean {
  return (
    path === "/auth/refresh" ||
    path === "/auth/csrf" ||
    path === "/auth/backup-codes/consume" ||
    path.startsWith("/auth/login") ||
    path.startsWith("/auth/register")
  )
}

// ---------------------------------------------------------------------------
// apiFetch
// ---------------------------------------------------------------------------

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

interface ApiRequestInit {
  method?: Method
  body?: unknown
  headers?: Record<string, string>
}

async function apiFetchCore<T>(
  path: string,
  method: Method,
  body: unknown,
  extraHeaders: Record<string, string>,
  retried: boolean,
): Promise<T> {
  const isMutating = method !== "GET"
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extraHeaders,
  }
  if (isMutating) {
    const token = await getCsrfToken()
    headers["x-csrf-token"] = token
    await invalidateRuntimeGetCache()
  }

  let res: Response
  try {
    res = await rawRequest(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (error) {
    throw toBackendUnavailableError(error)
  }

  if (res.status === 401 && !retried && !isPreSessionPath(path)) {
    await invalidateRuntimeGetCache()
    const result = await refreshSession()
    if (result.ok) return apiFetchCore<T>(path, method, body, extraHeaders, true)
    if (result.reason === "refresh_expired") throw new SessionExpiredError()
    if (result.reason === "network_error") throw new BackendUnavailableError()
    throw new ApiError(503, "REFRESH_FAILED", `Refresh failed: ${result.reason}`)
  }

  if (res.status === 204) return undefined as T

  const data: unknown = await res.json().catch(() => ({}))

  if (!res.ok) {
    const errData = data as { error?: { code?: string; message?: string } }
    throw new ApiError(
      res.status,
      errData.error?.code ?? "UNKNOWN",
      errData.error?.message ?? "An error occurred",
    )
  }

  if (
    typeof window !== "undefined" &&
    data &&
    typeof data === "object" &&
    "accessExpiresAt" in data
  ) {
    const exp = (data as { accessExpiresAt?: unknown }).accessExpiresAt
    if (typeof exp === "number") {
      _clientAccessExpiresAt = exp
      _authCallbacks.onAccessExpiryUpdate?.(exp)
    }
  }

  return data as T
}

export async function apiFetch<T = unknown>(
  path: string,
  { method = "GET", body, headers: extraHeaders = {} }: ApiRequestInit = {},
): Promise<T> {
  if (method === "GET") {
    const state = await getRuntimeState()
    const cached = state.getCache.get(path)
    if (cached) return cached as Promise<T>
    const promise = apiFetchCore<T>(path, method, body, extraHeaders, false).catch((err) => {
      state.getCache.delete(path)
      throw err
    })
    state.getCache.set(path, promise)
    return promise
  }
  return apiFetchCore<T>(path, method, body, extraHeaders, false)
}

export async function apiFetchAllowErrorBody<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<{ response: Response; data: T | undefined }> {
  let response: Response
  try {
    response = await rawRequest(path, init)
  } catch (error) {
    throw toBackendUnavailableError(error)
  }
  const data = (await response.json().catch(() => undefined)) as T | undefined
  return { response, data }
}
