// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, test } from "bun:test"
import {
  ContainerSnapshotSchema,
  MonitoringEventSchema,
  MonitoringOverviewSchema,
  healthClass,
  memRatio,
} from "./monitoring"

// Fixture de base valide pour ContainerSnapshot.
const baseSnap = {
  id: "abc123",
  name: "my-container",
  image: "nginx:latest",
  status: "running" as const,
  uptime_s: 3600,
  cpu_pct: 12.5,
  mem_bytes: 50_000_000,
  mem_limit_bytes: 100_000_000,
  restart_count: 0,
  last_seen_ms: Date.now(),
}

describe("ContainerSnapshotSchema", () => {
  test("parse d'un objet valide retourne un ContainerSnapshot", () => {
    const result = ContainerSnapshotSchema.parse(baseSnap)
    expect(result.id).toBe("abc123")
    expect(result.status).toBe("running")
    expect(result.cpu_pct).toBe(12.5)
  })

  test("rejette un status inconnu", () => {
    expect(() =>
      ContainerSnapshotSchema.parse({ ...baseSnap, status: "deleted" })
    ).toThrow()
  })

  test("rejette un cpu_pct négatif", () => {
    expect(() =>
      ContainerSnapshotSchema.parse({ ...baseSnap, cpu_pct: -1 })
    ).toThrow()
  })
})

describe("memRatio", () => {
  test("50M / 100M = 0.5", () => {
    const snap = ContainerSnapshotSchema.parse({
      ...baseSnap,
      mem_bytes: 50_000_000,
      mem_limit_bytes: 100_000_000,
    })
    expect(memRatio(snap)).toBe(0.5)
  })

  test("0 / 100M = 0", () => {
    const snap = ContainerSnapshotSchema.parse({
      ...baseSnap,
      mem_bytes: 0,
      mem_limit_bytes: 100_000_000,
    })
    expect(memRatio(snap)).toBe(0)
  })

  test("limit 0 → 0 (pas de division par zéro)", () => {
    const snap = ContainerSnapshotSchema.parse({
      ...baseSnap,
      mem_bytes: 100_000_000,
      mem_limit_bytes: 0,
    })
    expect(memRatio(snap)).toBe(0)
  })

  test("200M / 100M cappé à 1", () => {
    const snap = ContainerSnapshotSchema.parse({
      ...baseSnap,
      mem_bytes: 200_000_000,
      mem_limit_bytes: 100_000_000,
    })
    expect(memRatio(snap)).toBe(1)
  })
})

describe("healthClass", () => {
  const snapWith = (status: string) =>
    ContainerSnapshotSchema.parse({ ...baseSnap, status })

  test("running → healthy", () => {
    expect(healthClass(snapWith("running"))).toBe("healthy")
  })

  test("starting → warn", () => {
    expect(healthClass(snapWith("starting"))).toBe("warn")
  })

  test("unhealthy → warn", () => {
    expect(healthClass(snapWith("unhealthy"))).toBe("warn")
  })

  test("stopped → down", () => {
    expect(healthClass(snapWith("stopped"))).toBe("down")
  })

  test("unknown → down", () => {
    expect(healthClass(snapWith("unknown"))).toBe("down")
  })
})

describe("MonitoringOverviewSchema", () => {
  test("parse un objet avec 2 containers", () => {
    const overview = MonitoringOverviewSchema.parse({
      containers: [
        baseSnap,
        { ...baseSnap, id: "def456", name: "second-container" },
      ],
      generated_at: Date.now(),
    })
    expect(overview.containers).toHaveLength(2)
    expect(overview.containers.at(0)?.id).toBe("abc123")
    expect(overview.containers.at(1)?.id).toBe("def456")
  })
})

describe("MonitoringEventSchema", () => {
  test("parse valide avec prev_status", () => {
    const event = MonitoringEventSchema.parse({
      type: "container.health",
      container: baseSnap,
      prev_status: "starting",
      t: Date.now(),
    })
    expect(event.type).toBe("container.health")
    expect(event.prev_status).toBe("starting")
  })

  test("parse valide sans prev_status (premier check)", () => {
    const event = MonitoringEventSchema.parse({
      type: "container.health",
      container: baseSnap,
      t: Date.now(),
    })
    expect(event.type).toBe("container.health")
    expect(event.prev_status).toBeUndefined()
  })
})
