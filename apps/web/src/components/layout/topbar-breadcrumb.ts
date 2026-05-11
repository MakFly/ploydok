// SPDX-License-Identifier: AGPL-3.0-only

export interface MatchWithLoader {
  routeId?: string
  params?: Record<string, string | undefined>
  loaderData?: unknown
}

function findAppMatch(
  matches: ReadonlyArray<MatchWithLoader>
): MatchWithLoader | undefined {
  return matches.find(
    (m) =>
      m.routeId === "/_authed/apps/$id" ||
      m.routeId === "/_authed/orgs/$orgSlug/apps/$id"
  )
}

export function extractAppId(
  matches: ReadonlyArray<MatchWithLoader>
): string | null {
  const appMatch = findAppMatch(matches)
  if (!appMatch) return null
  const data = appMatch.loaderData as
    | { app?: { id?: string | null } }
    | undefined
  return data?.app?.id ?? appMatch.params?.id ?? null
}

export interface BreadcrumbItem {
  label: string
  to?: string
}

export function extractAppName(
  matches: ReadonlyArray<MatchWithLoader>
): string | null {
  const appMatch = findAppMatch(matches)
  if (!appMatch) return null
  const data = appMatch.loaderData as
    | { app?: { name?: string | null } }
    | undefined
  return data?.app?.name ?? null
}

export function extractAppStatus(
  matches: ReadonlyArray<MatchWithLoader>
): string | null {
  const appMatch = findAppMatch(matches)
  if (!appMatch) return null
  const data = appMatch.loaderData as
    | { app?: { status?: string | null } }
    | undefined
  return data?.app?.status ?? null
}

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === "/") return "/"
  return pathname.endsWith("/") ? pathname.slice(0, -1) || "/" : pathname
}

function humanizeSegment(segment: string): string {
  return segment
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

const WORKSPACE: BreadcrumbItem = { label: "Workspace" }
const PLATFORM: BreadcrumbItem = { label: "Platform" }
const INTEGRATIONS: BreadcrumbItem = { label: "Integrations" }

export function resolveTopbarBreadcrumb(
  pathname: string,
  appName: string | null,
  orgSlug?: string | null
): Array<BreadcrumbItem> {
  let normalized = normalizePathname(pathname)
  let isOrgScoped = false
  if (normalized.startsWith("/orgs/")) {
    isOrgScoped = true
    const parts = normalized.split("/").filter(Boolean)
    if (!orgSlug) orgSlug = parts[1] ?? null
    normalized =
      parts.length > 2 ? `/${parts.slice(2).join("/")}` : "/dashboard"
  }
  const orgPrefix = isOrgScoped && orgSlug ? `/orgs/${orgSlug}` : ""
  const ws = (path: string) => `${orgPrefix}${path}`

  if (normalized === "/dashboard") {
    return [WORKSPACE, { label: "Dashboard" }]
  }

  if (normalized === "/guide") {
    return [{ label: "Guide" }]
  }

  if (normalized === "/changelog") {
    return [{ label: "Changelog" }]
  }

  if (normalized === "/monitoring") {
    return [WORKSPACE, { label: "Monitoring" }]
  }

  if (normalized === "/marketplace") {
    return [WORKSPACE, { label: "Marketplace" }]
  }

  if (normalized === "/deployments") {
    return [WORKSPACE, { label: "Deployments" }]
  }

  if (normalized === "/settings") {
    return [{ label: "Settings" }]
  }

  if (normalized.startsWith("/settings/")) {
    const segments = normalized.split("/").filter(Boolean).slice(1)
    const items: Array<BreadcrumbItem> = [
      { label: "Settings", to: "/settings" },
    ]

    if (segments[0] === "security") {
      items.push({ label: "Security", to: "/settings/security" })
      const securityLabels: Record<string, string> = {
        passkey: "Passkeys",
        passkeys: "Passkeys",
        posture: "Posture",
        sessions: "Sessions",
        totp: "TOTP",
      }
      const child = segments[1]
      if (child) {
        items.push({ label: securityLabels[child] ?? humanizeSegment(child) })
      } else {
        items[items.length - 1] = { label: "Security" }
      }
      return items
    }

    if (
      segments[0] === "git-providers" ||
      segments[0] === "registry" ||
      segments[0] === "notifications"
    ) {
      items[0] = INTEGRATIONS
    }

    if (segments[0] === "git-providers") {
      items.push({
        label: "Git providers",
        to: "/settings/git-providers",
      })
      const providerLabels: Record<string, string> = {
        github: "GitHub",
        gitlab: "GitLab",
      }
      const child = segments[1]
      if (child) {
        items.push({ label: providerLabels[child] ?? humanizeSegment(child) })
      } else {
        items[items.length - 1] = { label: "Git providers" }
      }
      return items
    }

    items.push({ label: humanizeSegment(segments[0] ?? "") })
    return items
  }

  if (normalized === "/apps") {
    return [WORKSPACE, { label: "Applications" }]
  }

  if (normalized === "/databases") {
    return [WORKSPACE, { label: "Databases" }]
  }

  if (normalized === "/members") {
    return [PLATFORM, { label: "Members" }]
  }

  if (normalized === "/audit") {
    return [PLATFORM, { label: "Audit" }]
  }

  if (normalized === "/shared-env") {
    return [PLATFORM, { label: "Shared env" }]
  }

  if (normalized === "/scheduled-jobs") {
    return [PLATFORM, { label: "Scheduled jobs" }]
  }

  if (normalized === "/event-webhooks") {
    return [PLATFORM, { label: "Event webhooks" }]
  }

  if (normalized === "/tags") {
    return [PLATFORM, { label: "Tags" }]
  }

  if (normalized === "/branding") {
    return [PLATFORM, { label: "Branding" }]
  }

  if (normalized.startsWith("/databases/")) {
    const segments = normalized.split("/").filter(Boolean)
    const dbId = segments[1]
    if (!dbId) return [WORKSPACE, { label: "Databases" }]
    return [
      WORKSPACE,
      { label: "Databases", to: ws("/databases") },
      { label: dbId },
    ]
  }

  if (normalized === "/services") {
    return [WORKSPACE, { label: "Services" }]
  }

  if (normalized.startsWith("/services/")) {
    const segments = normalized.split("/").filter(Boolean)
    const serviceId = segments[1]
    if (!serviceId) return [WORKSPACE, { label: "Services" }]
    return [
      WORKSPACE,
      { label: "Services", to: ws("/services") },
      { label: serviceId },
    ]
  }

  if (normalized.startsWith("/apps/")) {
    const segments = normalized.split("/").filter(Boolean)
    const items: Array<BreadcrumbItem> = [
      WORKSPACE,
      { label: "Applications", to: ws("/apps") },
    ]
    const appId = segments[1]
    if (!appId) return items

    items.push({
      label: appName ?? appId,
      to: ws(`/apps/${appId}/settings`),
    })

    const appTabLabels: Record<string, string> = {
      deployments: "Deployments",
      logs: "Logs",
      shell: "Shell",
      settings: "General",
      advanced: "Advanced",
      env: "Env",
      domains: "Domains",
    }
    const child = segments[2]
    if (child) {
      items.push({ label: appTabLabels[child] ?? humanizeSegment(child) })
    } else {
      items[items.length - 1] = { label: appName ?? appId }
    }
    return items
  }

  return []
}
