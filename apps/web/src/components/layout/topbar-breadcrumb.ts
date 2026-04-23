// SPDX-License-Identifier: AGPL-3.0-only

export interface MatchWithLoader {
  routeId?: string
  loaderData?: unknown
}

export interface BreadcrumbItem {
  label: string
  to?: string
}

export function extractAppName(
  matches: ReadonlyArray<MatchWithLoader>
): string | null {
  const appMatch = matches.find(
    (m) => m.routeId === "/_authed/apps/$id" || m.routeId === "/_authed/orgs/$orgSlug/apps/$id"
  )
  if (!appMatch) return null
  const data = appMatch.loaderData as
    | { app?: { name?: string | null } }
    | undefined
  return data?.app?.name ?? null
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

export function resolveTopbarBreadcrumb(
  pathname: string,
  appName: string | null
): Array<BreadcrumbItem> {
  let normalized = normalizePathname(pathname)
  if (normalized.startsWith("/orgs/")) {
    const parts = normalized.split("/").filter(Boolean)
    normalized = parts.length > 2 ? `/${parts.slice(2).join("/")}` : "/dashboard"
  }

  if (normalized === "/dashboard") {
    return [{ label: "Dashboard" }]
  }

  if (normalized === "/guide") {
    return [{ label: "Guide" }]
  }

  if (normalized === "/monitoring") {
    return [{ label: "Monitoring" }]
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
    return [{ label: "Apps" }]
  }

  if (normalized === "/databases") {
    return [{ label: "Databases" }]
  }

  if (normalized.startsWith("/databases/")) {
    return [
      { label: "Databases", to: "/databases" },
      { label: "Database" },
    ]
  }

  if (normalized.startsWith("/apps/")) {
    const segments = normalized.split("/").filter(Boolean)
    const items: Array<BreadcrumbItem> = [{ label: "Apps", to: "/apps" }]
    const appId = segments[1]
    if (!appId) return items

    items.push({ label: appName ?? "App", to: `/apps/${appId}/overview` })

    const appTabLabels: Record<string, string> = {
      overview: "Overview",
      deployments: "Deployments",
      logs: "Logs",
      shell: "Shell",
      settings: "Settings",
      env: "Env",
      domains: "Domains",
    }
    const child = segments[2]
    if (child) {
      items.push({ label: appTabLabels[child] ?? humanizeSegment(child) })
    } else {
      items[items.length - 1] = { label: appName ?? "App" }
    }
    return items
  }

  return []
}
