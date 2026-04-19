// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";

import appCss from "@workspace/ui/globals.css?url";
import { ApiErrorState } from "../components/errors/ApiErrorState";
import { NotFoundState } from "../components/errors/NotFoundState";
import { invalidateGetCache, setAuthCallbacks } from "../lib/api";
import { broadcastAuthEvent, subscribeAuthEvents } from "../lib/api/broadcast";
import { startProactiveRefresh } from "../lib/api/scheduler";
import type { ErrorComponentProps } from "@tanstack/react-router";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

function RootErrorComponent({ error, reset }: ErrorComponentProps): React.JSX.Element {
  const status =
    error instanceof Error && "status" in error
      ? (error as Error & { status?: number }).status
      : undefined;
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <ApiErrorState status={status} message={error.message} onRetry={reset} />
    </div>
  );
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
});

// AuthSyncProvider wires together three pieces of the refresh-token machinery:
//   1. cross-tab events: when this tab refreshes, peers invalidate their cache;
//      when this tab is logged out (refresh expired), peers hard-redirect.
//   2. proactive refresh: the scheduler fires ~60s before access expires.
//   3. centralized callback registry inside lib/api so refreshSession can
//      notify both layers at once.
// Mounted once at the root inside QueryClientProvider; SSR no-ops via guards.
function AuthSyncProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  React.useEffect(() => {
    const unsubBroadcast = subscribeAuthEvents({
      onTokenRefreshed: () => {
        // A peer tab refreshed. The browser cookie store already has the new
        // tokens — drop our cached /me so the next read picks them up.
        invalidateGetCache();
      },
      onLoggedOut: () => {
        // Hard navigate so the React tree, queries and module state all reset.
        window.location.href = "/login";
      },
    });
    const scheduler = startProactiveRefresh();
    setAuthCallbacks({
      onTokenRefreshed: () => broadcastAuthEvent({ type: "token_refreshed" }),
      onLoggedOut: () => broadcastAuthEvent({ type: "logged_out" }),
      onAccessExpiryUpdate: () => scheduler.reschedule(),
    });
    return () => {
      unsubBroadcast();
      scheduler.stop();
      setAuthCallbacks({});
    };
  }, []);
  return <>{children}</>;
}

function RootDocument({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
        {/* Apply dark theme before paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem('ploydok-theme');if(t==='light'){document.documentElement.classList.remove('dark');}})();`,
          }}
        />
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          <AuthSyncProvider>
            {children}
            <Toaster position="bottom-center" richColors />
          </AuthSyncProvider>
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
