// SPDX-License-Identifier: AGPL-3.0-only

import { z } from "zod"

// Status d'un container vu côté API (mapping des états Docker).
export const ContainerStatusSchema = z.enum([
  "running",
  "starting",
  "unhealthy",
  "stopped",
  "unknown",
])
export type ContainerStatus = z.infer<typeof ContainerStatusSchema>

export const ContainerKindSchema = z.enum(["app", "infra", "agent"])
export type ContainerKind = z.infer<typeof ContainerKindSchema>

export const ContainerColorSchema = z.enum(["blue", "green"])
export type ContainerColor = z.infer<typeof ContainerColorSchema>

export const ContainerSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string(),
  status: ContainerStatusSchema,
  uptime_s: z.number().int().nonnegative(),
  cpu_pct: z.number().nonnegative(),
  mem_bytes: z.number().int().nonnegative(),
  mem_limit_bytes: z.number().int().nonnegative(),
  restart_count: z.number().int().nonnegative(),
  kind: ContainerKindSchema.optional(), // absent si inconnu
  app_id: z.string().optional(), // présent si kind === "app"
  color: ContainerColorSchema.optional(), // présent si kind === "app"
  last_ping_ms: z.number().int().nonnegative().optional(),
  last_ping_ok: z.boolean().optional(),
  last_seen_ms: z.number().int().nonnegative(), // Date.now() du dernier poll
})
export type ContainerSnapshot = z.infer<typeof ContainerSnapshotSchema>

export const MonitoringOverviewSchema = z.object({
  containers: z.array(ContainerSnapshotSchema),
  generated_at: z.number().int().nonnegative(), // Date.now() du snapshot
  // Si présent, l'agent était injoignable ou a renvoyé une erreur. Le payload
  // reste structurellement valide pour que le front affiche un état dégradé.
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
})
export type MonitoringOverview = z.infer<typeof MonitoringOverviewSchema>

// Event émis sur SSE quand le status d'un container change.
export const MonitoringEventSchema = z.object({
  type: z.literal("container.health"),
  container: ContainerSnapshotSchema,
  prev_status: ContainerStatusSchema.optional(), // absent au premier check
  t: z.number().int().nonnegative(),
})
export type MonitoringEvent = z.infer<typeof MonitoringEventSchema>

// Helper util — calcule un ratio mem 0-1.
export function memRatio(snap: ContainerSnapshot): number {
  if (snap.mem_limit_bytes === 0) return 0
  return Math.min(1, snap.mem_bytes / snap.mem_limit_bytes)
}

// Helper util — classe un container en "healthy"|"warn"|"down" pour l'UI.
export type HealthClass = "healthy" | "warn" | "down"
export function healthClass(snap: ContainerSnapshot): HealthClass {
  switch (snap.status) {
    case "running":
      return "healthy"
    case "starting":
    case "unhealthy":
      return "warn"
    case "stopped":
    case "unknown":
    default:
      return "down"
  }
}
