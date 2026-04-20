// SPDX-License-Identifier: AGPL-3.0-only
import { Queue } from "bullmq"
import { createRedis } from "@ploydok/db"
import { env } from "../env"

const connection = createRedis(env.REDIS_URL)

export const deployQueue = new Queue("deploy", { connection })
export const gcQueue = new Queue("gc.registry", { connection })
export const cleanupQueue = new Queue("cleanup.build", { connection })
export const appDeleteQueue = new Queue("app.delete", { connection })

export type QueueName = "deploy" | "gc.registry" | "cleanup.build" | "app.delete"
