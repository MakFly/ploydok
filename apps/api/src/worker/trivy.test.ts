// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import { parseTrivySeverityCounts } from "./trivy"

describe("parseTrivySeverityCounts", () => {
  it("sums mixed severities across multiple Results", () => {
    const report = {
      Results: [
        {
          Target: "app (alpine 3.19)",
          Vulnerabilities: [
            { VulnerabilityID: "CVE-1", Severity: "CRITICAL" },
            { VulnerabilityID: "CVE-2", Severity: "HIGH" },
            { VulnerabilityID: "CVE-3", Severity: "HIGH" },
            { VulnerabilityID: "CVE-4", Severity: "MEDIUM" },
          ],
        },
        {
          Target: "app/package-lock.json",
          Vulnerabilities: [
            { VulnerabilityID: "CVE-5", Severity: "LOW" },
            { VulnerabilityID: "CVE-6", Severity: "UNKNOWN" },
          ],
        },
      ],
    }

    expect(parseTrivySeverityCounts(report)).toEqual({
      critical: 1,
      high: 2,
      medium: 1,
      low: 1,
      unknown: 1,
    })
  })

  it("returns zero counts for an empty Results array", () => {
    expect(parseTrivySeverityCounts({ Results: [] })).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      unknown: 0,
    })
  })

  it("returns zero counts when a Result has no Vulnerabilities field", () => {
    const report = {
      Results: [{ Target: "app (distroless)" }],
    }

    expect(parseTrivySeverityCounts(report)).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      unknown: 0,
    })
  })

  it("tolerates missing Results field entirely", () => {
    expect(parseTrivySeverityCounts({})).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      unknown: 0,
    })
  })

  it("tolerates non-object / null input", () => {
    expect(parseTrivySeverityCounts(null)).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      unknown: 0,
    })
    expect(parseTrivySeverityCounts(undefined)).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      unknown: 0,
    })
  })

  it("treats an unrecognized severity string as unknown", () => {
    const report = {
      Results: [
        { Vulnerabilities: [{ VulnerabilityID: "CVE-7", Severity: "WEIRD" }] },
      ],
    }

    expect(parseTrivySeverityCounts(report)).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      unknown: 1,
    })
  })
})
