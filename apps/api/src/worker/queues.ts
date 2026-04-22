// SPDX-License-Identifier: AGPL-3.0-only
import { Queue } from "bullmq"
import { createRedis } from "@ploydok/db"
import { env } from "../env"

const connection = createRedis(env.REDIS_URL)

const deployDefaults = {
  removeOnComplete: 100,
  removeOnFail: 500,
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5000 },
}

export const deployQueue = new Queue("deploy", { connection, defaultJobOptions: deployDefaults })
export const gcQueue = new Queue("gc.registry", { connection })
export const cleanupQueue = new Queue("cleanup.build", { connection })
export const appDeleteQueue = new Queue("app.delete", { connection })

const domainVerifyDefaults = {
  removeOnComplete: 50,
  removeOnFail: 200,
  // Poll every 30s, max 20 attempts = 10 min window
  attempts: 20,
  backoff: { type: "fixed" as const, delay: 30_000 },
}
export const domainVerifyQueue = new Queue("domain.verify", { connection, defaultJobOptions: domainVerifyDefaults })

export type QueueName = "deploy" | "gc.registry" | "cleanup.build" | "app.delete" | "domain.verify"
