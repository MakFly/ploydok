// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { app } from "../app"
import { collectProcessMetrics, counter, gauge, renderMetrics } from "./metrics"

describe("metrics renderer", () => {
  test("counter inc + render au format Prometheus", () => {
    const c = counter("test_counter_total", "test counter")
    c.inc({ method: "GET", status: "200" })
    c.inc({ method: "GET", status: "200" })
    c.inc({ method: "POST", status: "500" })

    const out = renderMetrics()
    expect(out).toContain("# HELP test_counter_total test counter")
    expect(out).toContain("# TYPE test_counter_total counter")
    expect(out).toContain('test_counter_total{method="GET",status="200"} 2')
    expect(out).toContain('test_counter_total{method="POST",status="500"} 1')
  })

  test("gauge set", () => {
    const g = gauge("test_gauge", "test gauge")
    g.set({ instance: "a" }, 42)
    const out = renderMetrics()
    expect(out).toContain('test_gauge{instance="a"} 42')
  })

  test("collectProcessMetrics expose uptime + heap", () => {
    collectProcessMetrics()
    const out = renderMetrics()
    expect(out).toContain("process_uptime_seconds")
    expect(out).toContain("nodejs_heap_size_used_bytes")
  })
})

describe("GET /metrics", () => {
  const original = Bun.env["PLOYDOK_METRICS_TOKEN"]

  beforeEach(() => {
    Bun.env["PLOYDOK_METRICS_TOKEN"] = "test-secret"
  })

  afterEach(() => {
    if (original === undefined) {
      delete Bun.env["PLOYDOK_METRICS_TOKEN"]
    } else {
      Bun.env["PLOYDOK_METRICS_TOKEN"] = original
    }
  })

  test("403 si var d'env absente", async () => {
    delete Bun.env["PLOYDOK_METRICS_TOKEN"]
    const res = await app.request("/metrics")
    expect(res.status).toBe(403)
  })

  test("401 sans Bearer correct", async () => {
    const res = await app.request("/metrics")
    expect(res.status).toBe(401)
  })

  test("200 avec Bearer correct + content-type Prometheus", async () => {
    const res = await app.request("/metrics", {
      headers: { Authorization: "Bearer test-secret" },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/plain")
    const body = await res.text()
    expect(body).toContain("http_requests_total")
  })
})

describe("GET /status", () => {
  test("retourne un JSON status + components", async () => {
    const res = await app.request("/status")
    const body = (await res.json()) as {
      status: string
      version: string
      components: Record<string, string>
    }
    expect(["operational", "degraded"]).toContain(body.status)
    expect(typeof body.version).toBe("string")
    expect(body.components).toHaveProperty("db")
    expect(body.components).toHaveProperty("agent")
    expect(body.components).toHaveProperty("caddy")
  })

  test("NE contient PAS socket/admin_url/latency_ms", async () => {
    const res = await app.request("/status")
    const body = await res.json()
    const jsonStr = JSON.stringify(body)
    expect(jsonStr).not.toContain("socket")
    expect(jsonStr).not.toContain("admin_url")
    expect(jsonStr).not.toContain("latency_ms")
  })

  test("retourne juste {status, version, components: {db, agent, caddy}} avec valeurs simples", async () => {
    const res = await app.request("/status")
    const body = (await res.json()) as {
      status?: string
      version?: string
      components?: Record<string, string>
    }
    const keys = Object.keys(body)
    expect(keys).toEqual(["status", "version", "components"])
    expect(Object.keys(body.components ?? {})).toEqual(["db", "agent", "caddy"])
    expect(body.components).toBeDefined()
    expect(["ok", "degraded", "down", "unknown"]).toContain(body.components!.db)
    expect(["ok", "degraded", "down", "unknown"]).toContain(
      body.components!.agent
    )
    expect(["ok", "degraded", "down", "unknown"]).toContain(
      body.components!.caddy
    )
  })
})

describe("GET /health/ready", () => {
  test("retourne report détaillé avec composants", async () => {
    const res = await app.request("/health/ready")
    const body = (await res.json()) as {
      ok: boolean
      version: string
      components: { db: { status: string }; agent: { status: string } }
    }
    expect(typeof body.ok).toBe("boolean")
    expect(body.components.db).toBeDefined()
    expect(body.components.agent).toBeDefined()
    expect([200, 503]).toContain(res.status)
  })
})
