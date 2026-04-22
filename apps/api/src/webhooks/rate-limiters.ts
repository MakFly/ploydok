// SPDX-License-Identifier: AGPL-3.0-only
import { createRedis } from "@ploydok/db"
import { env } from "../env"
import { createRateLimiter } from "./rate-limit"

const redis = createRedis(env.REDIS_URL)

// TODO(post-3.1.1): read max from instance_settings.webhook_rate_limit_per_min
const DEFAULT_MAX_PER_MIN = 100
const WINDOW_SEC = 60

export const githubWebhookRateLimit = createRateLimiter({
  redis,
  windowSec: WINDOW_SEC,
  max: DEFAULT_MAX_PER_MIN,
  keyPrefix: "rl:webhook:github",
  keyFrom: (c) => c.req.header("x-github-hook-installation-target-id") ?? null,
})

export const gitlabWebhookRateLimit = createRateLimiter({
  redis,
  windowSec: WINDOW_SEC,
  max: DEFAULT_MAX_PER_MIN,
  keyPrefix: "rl:webhook:gitlab",
  keyFrom: (c) => c.req.header("x-gitlab-webhook-uuid") ?? null,
})
