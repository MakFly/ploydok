// SPDX-License-Identifier: AGPL-3.0-only

type HonoRoute = {
  method: string
  path: string
}

type OpenApiOperation = {
  tags: string[]
  summary: string
  security?: Array<Record<string, string[]>>
  parameters?: Array<{
    in: "path"
    name: string
    required: true
    schema: { type: "string" }
  }>
  responses: Record<string, { description: string }>
}

type OpenApiDocument = {
  openapi: "3.1.0"
  info: {
    title: string
    version: string
    description: string
  }
  servers: Array<{ url: string; description: string }>
  tags: Array<{ name: string }>
  paths: Record<string, Record<string, OpenApiOperation>>
  components: {
    securitySchemes: {
      cookieAuth: { type: "apiKey"; in: "cookie"; name: string }
      bearerAuth: { type: "http"; scheme: "bearer" }
      csrfToken: { type: "apiKey"; in: "header"; name: string }
    }
  }
}

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"])

const PUBLIC_PATHS = new Set([
  "/health",
  "/health/ready",
  "/status",
  "/metrics",
  "/openapi.json",
  "/auth/csrf",
  "/auth/refresh",
  "/auth/setup/password",
  "/auth/setup/options",
  "/auth/setup/verify",
  "/auth/login/password",
  "/auth/login/options",
  "/auth/login/verify",
  "/auth/backup-codes/consume",
  "/github/webhook",
  "/gitlab/webhook",
  "/gitlab/callback",
  "/license/status",
])

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

function normalizePath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")
}

function pathParams(path: string): OpenApiOperation["parameters"] {
  const params = [...path.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => {
    const name = match[1] ?? "id"
    return {
      in: "path" as const,
      name,
      required: true as const,
      schema: { type: "string" as const },
    }
  })
  return params.length > 0 ? params : undefined
}

function tagFor(path: string): string {
  if (path.startsWith("/auth") || path === "/me") return "Auth"
  if (path.startsWith("/api-tokens")) return "API Tokens"
  if (path.startsWith("/apps") || path.startsWith("/ws/apps")) return "Apps"
  if (path.includes("/domains")) return "Domains"
  if (path.startsWith("/databases") || path.includes("/backups")) {
    return "Databases"
  }
  if (path.startsWith("/github") || path.startsWith("/gitlab")) {
    return "Git Providers"
  }
  if (path.startsWith("/organizations") || path.startsWith("/orgs")) {
    return "Organizations"
  }
  if (path.startsWith("/monitoring") || path.startsWith("/host-stats")) {
    return "Monitoring"
  }
  if (path.startsWith("/notifications")) return "Notifications"
  if (path.startsWith("/audit")) return "Audit"
  if (path.startsWith("/services")) return "Services"
  if (path.startsWith("/license")) return "License"
  if (path.startsWith("/health") || path.startsWith("/status")) return "Status"
  return "Platform"
}

function summaryFor(method: string, path: string): string {
  const cleaned = path
    .replaceAll("{", "")
    .replaceAll("}", "")
    .split("/")
    .filter(Boolean)
    .join(" ")
  return `${method.toUpperCase()} ${cleaned || "root"}`
}

function operationFor(method: string, path: string): OpenApiOperation {
  const parameters = pathParams(path)
  const operation: OpenApiOperation = {
    tags: [tagFor(path)],
    summary: summaryFor(method, path),
    responses: {
      "200": { description: "Success" },
      "400": { description: "Invalid request" },
      "401": { description: "Not authenticated" },
      "403": { description: "Forbidden" },
      "404": { description: "Not found" },
    },
  }

  if (parameters) operation.parameters = parameters

  if (!PUBLIC_PATHS.has(path)) {
    operation.security = MUTATING_METHODS.has(method)
      ? [{ cookieAuth: [], csrfToken: [] }, { bearerAuth: [] }]
      : [{ cookieAuth: [] }, { bearerAuth: [] }]
  }

  return operation
}

export function createOpenApiDocument(
  routes: HonoRoute[],
  version = "0.0.1"
): OpenApiDocument {
  const paths: OpenApiDocument["paths"] = {}
  const tagNames = new Set<string>()

  for (const route of routes) {
    if (!METHODS.has(route.method)) continue
    if (route.path.startsWith("/__test/")) continue

    const path = normalizePath(route.path)
    const method = route.method.toLowerCase()
    paths[path] ??= {}
    if (paths[path][method]) continue

    const operation = operationFor(route.method, path)
    const tag = operation.tags[0] ?? "Platform"
    tagNames.add(tag)
    paths[path][method] = operation
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Ploydok Platform API",
      version,
      description:
        "Generated from the Hono route registry. Mutating authenticated browser requests also use double-submit CSRF protection.",
    },
    servers: [
      { url: "http://localhost:3335", description: "Local API server" },
      { url: "https://api.ploydok.dev", description: "Production API" },
    ],
    tags: [...tagNames].sort().map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "ploydok_access",
        },
        bearerAuth: {
          type: "http",
          scheme: "bearer",
        },
        csrfToken: {
          type: "apiKey",
          in: "header",
          name: "x-csrf-token",
        },
      },
    },
  }
}
