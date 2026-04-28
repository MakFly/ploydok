// SPDX-License-Identifier: AGPL-3.0-only
import { redirect } from "@tanstack/react-router"
import { ApiError, SessionExpiredError, apiFetch } from "./api"
import { organizationDashboardPath } from "./organizations"
import type { Me } from "@ploydok/shared"

interface InstanceState {
  bootstrapped: boolean
}

// Probe consumed by the public-route guard. Routes a brand-new visitor to
// /setup until the first admin exists, and bounces stragglers off /setup once
// the instance is bootstrapped. Network errors fall through (the user gets a
// proper error boundary, not a redirect loop).
export async function enforceInstanceState(pathname: string): Promise<void> {
  let state: InstanceState
  try {
    state = await apiFetch<InstanceState>("/auth/instance-state")
  } catch {
    return
  }
  const onSetup = pathname === "/setup"
  if (!state.bootstrapped && !onSetup) {
    throw redirect({ to: "/setup" })
  }
  if (state.bootstrapped && onSetup) {
    throw redirect({ to: "/login" })
  }
}

function isRedirect(err: unknown): boolean {
  return typeof err === "object" && err !== null && "href" in err
}

function isUnauthenticated(err: unknown): boolean {
  return (
    err instanceof SessionExpiredError ||
    (err instanceof ApiError && err.status === 401)
  )
}

// Use in beforeLoad of an authenticated route:
//   beforeLoad: async () => ({ me: await requireMe() })
// On any auth failure, redirects to /login. Per-request SSR state (cookie
// rotation, single-flight refresh) is handled inside apiFetch via TanStack
// Start's native getRequest()/setResponseHeader plumbing.
export async function requireMe(
  fetchMe: () => Promise<Me> = () => apiFetch<Me>("/me")
): Promise<Me> {
  try {
    return await fetchMe()
  } catch (err) {
    if (isRedirect(err)) throw err
    if (!isUnauthenticated(err)) throw err
    throw redirect({ to: "/login" })
  }
}

function resolveDefaultOrganizationPath(me: Me): string {
  return me.default_organization
    ? organizationDashboardPath(me.default_organization.slug)
    : "/dashboard"
}

// Use in beforeLoad of a public route that should bounce authenticated users
// (e.g. /login, /register, /). If /me succeeds, redirects to /dashboard.
export async function redirectIfAuthenticated(
  fetchMe: () => Promise<Me> = () => apiFetch<Me>("/me")
): Promise<void> {
  try {
    const me = await fetchMe()
    throw redirect({ href: resolveDefaultOrganizationPath(me) })
  } catch (err) {
    if (isRedirect(err)) throw err
    if (!isUnauthenticated(err)) throw err
    // Not authenticated — fall through, the route renders normally.
  }
}

export async function redirectToDefaultOrganization(
  fetchMe: () => Promise<Me> = () => apiFetch<Me>("/me")
): Promise<never> {
  const me = await requireMe(fetchMe)
  throw redirect({ href: resolveDefaultOrganizationPath(me) })
}
