// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query"
import { Toaster } from "sonner"

import appCss from "@workspace/ui/globals.css?url"
import { ApiErrorState } from "../components/errors/ApiErrorState"
import { NotFoundState } from "../components/errors/NotFoundState"
import {
  clearBackendUnavailable,
  setBackendUnavailable,
  useBackendUnavailable,
} from "../lib/backend-status"
import {
  BackendUnavailableError,
  invalidateGetCache,
  setAuthCallbacks,
} from "../lib/api"
import { broadcastAuthEvent, subscribeAuthEvents } from "../lib/api/broadcast"
import { startProactiveRefresh } from "../lib/api/scheduler"
import type { ErrorComponentProps } from "@tanstack/react-router"

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (!(error instanceof BackendUnavailableError)) return
      if (query.meta?.["critical"] !== true) return
      setBackendUnavailable(error.message)
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})

function RootErrorComponent({
  error,
  reset,
}: ErrorComponentProps): React.JSX.Element {
  const status =
    error instanceof Error && "status" in error
      ? (error as Error & { status?: number }).status
      : undefined
  const code =
    error instanceof Error && "code" in error
      ? (error as Error & { code?: string }).code
      : undefined
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <ApiErrorState
        code={code}
        status={status}
        message={error.message}
        onRetry={reset}
      />
    </div>
  )
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Ploydok" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
  errorComponent: RootErrorComponent,
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center p-8">
      <NotFoundState />
    </div>
  ),
})

function BrandingInjector(): React.JSX.Element {
  React.useEffect(() => {
    const loadBranding = async () => {
      try {
        const res = await fetch("/api/me")
        if (!res.ok) return

        const user = (await res.json()) as {
          current_organization_slug?: string
        }
        if (!user.current_organization_slug) return

        const brandingRes = await fetch(
          `/api/orgs/${user.current_organization_slug}/branding`
        )
        if (!brandingRes.ok) return

        const data = (await brandingRes.json()) as { branding: any }
        const branding = data.branding

        if (!branding) return

        if (branding.app_name) {
          document.title = branding.app_name
        }

        if (branding.favicon_url) {
          const link =
            document.querySelector('link[rel="icon"]') ||
            document.createElement("link")
          link.setAttribute("rel", "icon")
          link.setAttribute("href", branding.favicon_url)
          if (!document.querySelector('link[rel="icon"]')) {
            document.head.appendChild(link)
          }
        }

        if (branding.primary_color) {
          const style = document.createElement("style")
          style.textContent = `:root { --primary: ${branding.primary_color}; }`
          document.head.appendChild(style)
        }
      } catch {
        // Silent fail if branding fetch fails
      }
    }

    loadBranding()
  }, [])

  return <></>
}

// AuthSyncProvider wires together three pieces of the refresh-token machinery:
//   1. cross-tab events: when this tab refreshes, peers invalidate their cache;
//      when this tab is logged out (refresh expired), peers hard-redirect.
//   2. proactive refresh: the scheduler fires ~60s before access expires.
//   3. centralized callback registry inside lib/api so refreshSession can
//      notify both layers at once.
// Mounted once at the root inside QueryClientProvider; SSR no-ops via guards.
function AuthSyncProvider({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const qc = useQueryClient()

  React.useEffect(() => {
    const unsubBroadcast = subscribeAuthEvents({
      onTokenRefreshed: () => {
        // A peer tab refreshed. The browser cookie store already has the new
        // tokens — drop our cached /me so the next read picks them up.
        invalidateGetCache()
      },
      onLoggedOut: () => {
        // Hard navigate so the React tree, queries and module state all reset.
        window.location.href = "/login"
      },
    })
    const scheduler = startProactiveRefresh()
    setAuthCallbacks({
      onTokenRefreshed: () => broadcastAuthEvent({ type: "token_refreshed" }),
      onLoggedOut: () => broadcastAuthEvent({ type: "logged_out" }),
      onAccessExpiryUpdate: () => scheduler.reschedule(),
    })
    return () => {
      unsubBroadcast()
      scheduler.stop()
      setAuthCallbacks({})
    }
  }, [])

  // When the tab becomes visible again after a long idle, browsers may have
  // throttled timers and dropped the SSE connection. refetchOnWindowFocus
  // covers `focus` events, but a tab can become visible without firing one
  // (e.g. switching back from another tab in the same window). Invalidate
  // every critical query on visibilitychange so apps grid, monitoring and
  // /me catch up to any state mutated while we were away.
  React.useEffect(() => {
    if (typeof document === "undefined") return
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return
      invalidateGetCache()
      void qc.invalidateQueries({
        predicate: (query) => query.meta?.["critical"] === true,
      })
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [qc])

  return <>{children}</>
}

function BackendUnavailableGate({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const backendUnavailable = useBackendUnavailable()
  const queryClient = useQueryClient()

  const handleRetry = React.useCallback(() => {
    clearBackendUnavailable()
    invalidateGetCache()
    void queryClient.resetQueries()
    void queryClient.invalidateQueries()
  }, [queryClient])

  if (backendUnavailable.active) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <ApiErrorState
          code="BACKEND_UNAVAILABLE"
          status={503}
          message={backendUnavailable.message}
          onRetry={handleRetry}
        />
      </div>
    )
  }

  return <>{children}</>
}

function RootDocument({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* Resolve theme from cookie (light|dark|system) before paint to avoid flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var m=document.cookie.match(/(?:^|; )ploydok-theme=([^;]+)/);var v=m?decodeURIComponent(m[1]):'system';var dark=v==='dark'||(v!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',dark);document.documentElement.style.colorScheme=dark?'dark':'light';})();`,
          }}
        />
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          <BrandingInjector />
          <AuthSyncProvider>
            <BackendUnavailableGate>{children}</BackendUnavailableGate>
            <Toaster position="bottom-center" theme="system" />
          </AuthSyncProvider>
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  )
}
