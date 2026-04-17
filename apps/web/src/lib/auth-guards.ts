// SPDX-License-Identifier: AGPL-3.0-only
import { redirect } from "@tanstack/react-router"
import { ApiError, SessionExpiredError, apiFetch } from "./api"
import type { Me } from "@ploydok/shared"

function isRedirect(err: unknown): boolean {
  return typeof err === "object" && err !== null && "href" in err
}

function isUnauthenticated(err: unknown): boolean {
  return err instanceof SessionExpiredError || (err instanceof ApiError && err.status === 401)
}

// Use in beforeLoad of an authenticated route:
//   beforeLoad: async () => ({ me: await requireMe() })
// On any auth failure, redirects to /login. Per-request SSR state (cookie
// rotation, single-flight refresh) is handled inside apiFetch via TanStack
// Start's native getRequest()/setResponseHeader plumbing.
export async function requireMe(fetchMe: () => Promise<Me> = () => apiFetch<Me>("/me")): Promise<Me> {
  try {
    return await fetchMe()
  } catch (err) {
    if (isRedirect(err)) throw err
    if (!isUnauthenticated(err)) throw err
    throw redirect({ to: "/login" })
  }
}

// Use in beforeLoad of a public route that should bounce authenticated users
// (e.g. /login, /register, /). If /me succeeds, redirects to /dashboard.
export async function redirectIfAuthenticated(
  fetchMe: () => Promise<Me> = () => apiFetch<Me>("/me"),
): Promise<void> {
  try {
    await fetchMe()
    throw redirect({ to: "/dashboard" })
  } catch (err) {
    if (isRedirect(err)) throw err
    if (!isUnauthenticated(err)) throw err
    // Not authenticated — fall through, the route renders normally.
  }
}
