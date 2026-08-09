// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import type { Db } from "@ploydok/db"
import {
  getGitHubAppConfig,
  getGitLabConfig,
  getGitLabTokens,
  hasGitHubInstallationForUser,
} from "@ploydok/db/queries"
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

    const [githubConfig, gitlabConfig, githubConnected, gitlabTokens] =
      await Promise.all([
        getGitHubAppConfig(db),
        getGitLabConfig(db),
        hasGitHubInstallationForUser(db, user.id),
        getGitLabTokens(db, user.id),
      ])

    const github = {
      configured: githubConfig !== null,
      connected: githubConnected,
      install_url: githubConfig
        ? `${apiOrigin(env.GITHUB_APP_CALLBACK_URL)}/github/installations/start`
        : null,
    }
    const gitlab = {
      configured: gitlabConfig !== null,
      connected: gitlabTokens !== null,
      connect_url: gitlabConfig
        ? `${apiOrigin(env.GITLAB_OAUTH_CALLBACK_URL)}/gitlab/connect`
        : null,
    }

    return c.json({ ready: github.connected || gitlab.connected, github, gitlab })
  })

  return router
}
