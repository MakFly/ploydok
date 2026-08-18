// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from "bun:test"
import { createDb, type Db } from "@ploydok/db"
import type { HostStatsResponse } from "@ploydok/agent-proto"
import { renderMetrics } from "./metrics"
import {
  collectOperationalMetrics,
  recordDeploymentOutcome,
  recordInitialBuildClaim,
} from "./operational-metrics"

const hostStats: HostStatsResponse = {
  cpuPercent: 10,
  memTotalBytes: 1_000,
  memUsedBytes: 400,
  memAvailableBytes: 600,
  swapTotalBytes: 0,
  swapUsedBytes: 0,
  load1: 0,
  load5: 0,
  load15: 0,
  diskTotalBytes: 1_000,
  diskUsedBytes: 800,
  diskFreeBytes: 200,
  inodesTotal: 100,
  inodesUsed: 10,
  cpuCount: 2,
  uptimeSeconds: 60,
  error: "",
  gpuCount: 0,
  gpuUtilizationPct: 0,
  gpuMemUsedBytes: 0,
  gpuMemTotalBytes: 0,
  gpuName: "",
}

describe("operational metrics", () => {
  test("publishes deployment, backup, queue, certificate, agent and disk gauges", async () => {
    const db = {
      execute: async () => [
        {
          deployments_total_15m: "10",
          deployments_failed_15m: "2",
          stuck_builds: "1",
          stuck_jobs: "3",
          backup_failures_24h: "3",
          stale_backup_resources: "2",
          outbox_pending: "4",
          outbox_stuck: "1",
          outbox_dead_lettered: "2",
          outbox_dead_lettered_15m: "1",
          certificates_expiring_30d: "3",
          certificates_expiring_7d: "2",
          certificates_expiring_1d: "1",
        },
      ],
    } as unknown as Db

    await collectOperationalMetrics(
      db,
      async () => hostStats,
      async () => ({
        ok: true,
        version: "test",
        components: {
          db: { status: "ok" },
          agent: { status: "ok" },
          caddy: { status: "ok" },
          ingress: {
            status: "ok",
            expected_http_routes: 0,
            missing_http_routes: [],
            expected_tcp_proxies: 0,
            missing_tcp_proxies: [],
          },
        },
      }),
      async () => ({
        configured: true,
        lastSuccessTimestampSeconds: 1_755_513_600,
        lastFailureTimestampSeconds: 1_755_427_200,
      })
    )
    const output = renderMetrics()

    expect(output).toContain("ploydok_deployments_total_15m 10")
    expect(output).toContain("ploydok_deployments_failed_15m 2")
    expect(output).toContain("ploydok_stuck_builds 1")
    expect(output).toContain("ploydok_stuck_jobs 3")
    expect(output).toContain("ploydok_backup_failures_24h 3")
    expect(output).toContain("ploydok_stale_backup_resources 2")
    expect(output).toContain(
      "ploydok_control_plane_backup_last_success_timestamp_seconds 1755513600"
    )
    expect(output).toContain("ploydok_control_plane_backup_configured 1")
    expect(output).toContain(
      "ploydok_control_plane_backup_last_failure_timestamp_seconds 1755427200"
    )
    expect(output).toContain("ploydok_outbox_stuck 1")
    expect(output).toContain("ploydok_outbox_dead_lettered_15m 1")
    expect(output).toContain('ploydok_certificates_expiring{within_days="7"} 2')
    expect(output).toContain("ploydok_agent_up 1")
    expect(output).toContain('ploydok_component_ready{component="caddy"} 1')
    expect(output).toContain("ploydok_host_disk_used_ratio 0.8")
    expect(output).toContain("ploydok_host_inodes_used_ratio 0.1")
    expect(output).toContain("ploydok_operational_metrics_error 0")
  })

  test("publishes durable SLI counters with an explicit failure classification", () => {
    recordDeploymentOutcome("succeeded")
    recordDeploymentOutcome("platform_failed")
    recordInitialBuildClaim(
      new Date("2026-08-18T10:00:00.000Z"),
      new Date("2026-08-18T10:04:00.000Z")
    )
    recordInitialBuildClaim(
      new Date("2026-08-18T10:00:00.000Z"),
      new Date("2026-08-18T10:06:00.000Z")
    )

    const output = renderMetrics()
    expect(output).toContain(
      'ploydok_deployment_outcomes_total{outcome="platform_failed"} 1'
    )
    expect(output).toContain(
      'ploydok_build_claims_total{within_slo="true"} 1'
    )
    expect(output).toContain(
      'ploydok_build_claims_total{within_slo="false"} 1'
    )
  })

  test("marks partial host stats as a collector error instead of exporting a false-zero disk", async () => {
    const db = {
      execute: async () => [
        {
          deployments_total_15m: 0,
          deployments_failed_15m: 0,
          stuck_builds: 0,
          stuck_jobs: 0,
          backup_failures_24h: 0,
          stale_backup_resources: 0,
          outbox_pending: 0,
          outbox_stuck: 0,
          outbox_dead_lettered: 0,
          outbox_dead_lettered_15m: 0,
          certificates_expiring_30d: 0,
          certificates_expiring_7d: 0,
          certificates_expiring_1d: 0,
        },
      ],
    } as unknown as Db

    await collectOperationalMetrics(
      db,
      async () => ({ ...hostStats, diskTotalBytes: 0, error: "disk:statvfs failed" }),
      async () => ({
        ok: true,
        version: "test",
        components: {
          db: { status: "ok" },
          agent: { status: "ok" },
          caddy: { status: "ok" },
          ingress: {
            status: "ok",
            expected_http_routes: 0,
            missing_http_routes: [],
            expected_tcp_proxies: 0,
            missing_tcp_proxies: [],
          },
        },
      })
    )

    const output = renderMetrics()
    expect(output).toContain("ploydok_agent_up 1")
    expect(output).toContain("ploydok_operational_metrics_error 1")
  })

  test("keeps the scrape available and exposes collector failure", async () => {
    const db = {
      execute: async () => {
        throw new Error("database unavailable")
      },
    } as unknown as Db

    await collectOperationalMetrics(
      db,
      async () => {
        throw new Error("agent unavailable")
      },
      async () => {
        throw new Error("readiness unavailable")
      }
    )
    const output = renderMetrics()

    expect(output).toContain("ploydok_agent_up 0")
    expect(output).toContain('ploydok_component_ready{component="caddy"} 0')
    expect(output).toContain("ploydok_operational_metrics_error 1")
  })
})

const testPgUrl = Bun.env.PLOYDOK_TEST_PG_URL
describe.skipIf(!testPgUrl)("operational metrics PostgreSQL contract", () => {
  test("executes the complete multi-table collector query", async () => {
    const db = createDb(testPgUrl!)
    try {
      await collectOperationalMetrics(
        db,
        async () => hostStats,
        async () => ({
          ok: true,
          version: "test",
          components: {
            db: { status: "ok" },
            agent: { status: "ok" },
            caddy: { status: "ok" },
            ingress: {
              status: "ok",
              expected_http_routes: 0,
              missing_http_routes: [],
              expected_tcp_proxies: 0,
              missing_tcp_proxies: [],
            },
          },
        }),
        async () => ({
          configured: false,
          lastSuccessTimestampSeconds: 0,
          lastFailureTimestampSeconds: 0,
        })
      )
      expect(renderMetrics()).toContain("ploydok_operational_metrics_error 0")
    } finally {
      await db.$client.end()
    }
  })
})
