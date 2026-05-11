// SPDX-License-Identifier: AGPL-3.0-only
import { createRedis } from "@ploydok/db"
import { env } from "../env"
import { createRateLimiter, rateLimitKeyFromProviderHeaderOrIp } from "./rate-limit"

const redis = createRedis(env.REDIS_URL)

// TODO(post-3.1.1): read max from instance_settings.webhook_rate_limit_per_min
const DEFAULT_MAX_PER_MIN = 100
const WINDOW_SEC = 60

export const githubWebhookRateLimit = createRateLimiter({
  redis,
  windowSec: WINDOW_SEC,
  max: DEFAULT_MAX_PER_MIN,
  keyPrefix: "rl:webhook:github",
  keyFrom: (c) =>
    rateLimitKeyFromProviderHeaderOrIp(
      c,
      "x-github-hook-installation-target-id",
      (value) => /^\d+$/.test(value),
    ),
})

export const gitlabWebhookRateLimit = createRateLimiter({
  redis,
  windowSec: WINDOW_SEC,
  max: DEFAULT_MAX_PER_MIN,
  keyPrefix: "rl:webhook:gitlab",
  keyFrom: (c) =>
    rateLimitKeyFromProviderHeaderOrIp(
      c,
      "x-gitlab-webhook-uuid",
      (value) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          value,
        ),
    ),
})
