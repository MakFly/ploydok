// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes, randomUUID } from "node:crypto"

export interface DslContext {
  projectSlug: string
  serverIp?: string
}

export interface ResolveResult {
  composeResolved: string
  generatedVars: Record<string, string>
  domain: string | null
}

export class UnknownDslHelperError extends Error {
  constructor(token: string) {
    super(`Unknown DSL helper: ${token}`)
    this.name = "UnknownDslHelperError"
  }
}

const HELPER_WHITELIST = new Set([
  "domain",
  "password",
  "base64",
  "hash",
  "uuid",
  "timestamp",
  "timestampms",
  "timestamps",
])

function helperName(varName: string): string {
  const colon = varName.indexOf(":")
  return colon === -1 ? varName : varName.slice(0, colon)
}

function numericArg(varName: string, defaultVal: number): number {
  const colon = varName.indexOf(":")
  if (colon === -1) return defaultVal
  const parsed = Number.parseInt(varName.slice(colon + 1), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultVal
}

function generateDomain(projectSlug: string, serverIp?: string): string {
  const hash = randomBytes(3).toString("hex")
  const slugIp = serverIp ? serverIp.replaceAll(".", "-") : ""
  return `${projectSlug}-${hash}${slugIp === "" ? "" : `-${slugIp}`}.traefik.me`
}

function generatePassword(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let out = ""
  for (let i = 0; i < length; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return out.toLowerCase()
}

export function resolveTemplate(
  compose: string,
  context: DslContext
): ResolveResult {
  if (!compose) {
    return { composeResolved: compose, generatedVars: {}, domain: null }
  }

  const cache = new Map<string, string>()
  const generatedVars: Record<string, string> = {}
  let domain: string | null = null

  const DSL_PATTERN = /\$\{([^}]+)\}/g

  // First pass: validate all helpers
  for (const match of compose.matchAll(DSL_PATTERN)) {
    const varName = match[1] ?? ""
    const name = helperName(varName)
    if (!HELPER_WHITELIST.has(name)) {
      throw new UnknownDslHelperError(match[0])
    }
  }

  // Second pass: resolve with caching
  const composeResolved = compose.replace(DSL_PATTERN, (_match, varName) => {
    const cacheKey = varName

    if (cache.has(cacheKey)) {
      return cache.get(cacheKey)!
    }

    let value: string

    if (varName === "domain") {
      value = generateDomain(context.projectSlug, context.serverIp)
      domain = value
    } else if (varName === "password") {
      value = generatePassword(16)
    } else if (varName.startsWith("password:")) {
      const len = numericArg(varName, 16)
      value = generatePassword(len)
    } else if (varName === "base64") {
      value = randomBytes(32).toString("base64")
    } else if (varName.startsWith("base64:")) {
      const len = numericArg(varName, 32)
      value = randomBytes(len).toString("base64")
    } else if (varName === "hash") {
      value = `${context.projectSlug}-${randomBytes(3).toString("hex")}`
    } else if (varName.startsWith("hash:")) {
      const len = numericArg(varName, 3)
      value = `${context.projectSlug}-${randomBytes(len).toString("hex")}`
    } else if (varName === "uuid") {
      value = randomUUID()
    } else if (varName === "timestamp" || varName === "timestampms") {
      value = Date.now().toString()
    } else {
      // varName === "timestamps"
      value = Math.round(Date.now() / 1000).toString()
    }

    cache.set(cacheKey, value)
    generatedVars[varName] = value
    return value
  })

  return { composeResolved, generatedVars, domain }
}
