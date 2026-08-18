// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import type { Db } from "@ploydok/db"
import {
  getGitHubAppConfig,
  getGitLabConfig,
  hasGitHubInstallationForUser,
} from "@ploydok/db/queries"
import { resolveGitLabConnection } from "../gitlab/connection"
import { env } from "../env"
import type { AuthUser } from "../auth/middleware"

type GitProvidersRouterEnv = { Variables: { user?: AuthUser } }

function apiOrigin(callbackUrl: string): string {
  return new URL(callbackUrl).origin
}

/** Non-secret provider readiness for the currently authenticated user. */
export function createGitProvidersRouter(db: Db): Hono<GitProvidersRouterEnv> {
  const router = new Hono<GitProvidersRouterEnv>()

  router.get("/status", async (c) => {
    const user = c.get("user")
    if (!user) return c.json({ error: "unauthenticated" }, 401)

    const [githubConfig, gitlabConfig, githubConnected, gitlabResolution] =
      await Promise.all([
        getGitHubAppConfig(db),
        getGitLabConfig(db),
        hasGitHubInstallationForUser(db, user.id),
        resolveGitLabConnection(db, user.id).then(
          (connection) => ({ connection, error: null }),
          (error: unknown) => ({ connection: null, error })
        ),
      ])

    const github = {
      configured: githubConfig !== null,
      connected: githubConnected,
      install_url: githubConfig
        ? `${apiOrigin(env.GITHUB_APP_CALLBACK_URL)}/github/installations/start`
        : null,
    }
    const gitlabConnected = gitlabResolution.connection !== null
    const gitlabErrorCode =
      gitlabResolution.error &&
      typeof gitlabResolution.error === "object" &&
      "code" in gitlabResolution.error
        ? String(gitlabResolution.error.code)
        : null
    const gitlabState = !gitlabConfig
      ? "not_configured"
      : gitlabConnected
        ? "connected"
        : gitlabErrorCode === "not_connected"
          ? "disconnected"
          : gitlabErrorCode === "expired"
            ? "expired"
            : "unavailable"
    const gitlab = {
      configured: gitlabConfig !== null,
      connected: gitlabConnected,
      state: gitlabState,
      connect_url: gitlabConfig
        ? `${apiOrigin(env.GITLAB_OAUTH_CALLBACK_URL)}/gitlab/connect`
        : null,
    }

    return c.json({
      ready: github.connected || gitlab.connected,
      github,
      gitlab,
    })
  })

  return router
}
