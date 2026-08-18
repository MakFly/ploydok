// SPDX-License-Identifier: AGPL-3.0-only

type AuditAdvisory = {
  id: number
  severity: string
}

type TriageEntry = {
  ids: number[]
  package: string
  severity: "high" | "critical"
  classification: "runtime" | "build-time" | "test-only" | "non-exploitable"
  decision: "temporarily-accepted" | "mitigated"
  rationale: string
}

type Triage = {
  schemaVersion: number
  reviewedOn: string
  reviewBy: string
  entries: TriageEntry[]
}

const triagePath = new URL("../security/advisory-triage.json", import.meta.url)
const triage = (await Bun.file(triagePath).json()) as Triage

const auditProcess = Bun.spawn(["bun", "audit", "--json"], {
  stdout: "pipe",
  stderr: "inherit",
})
const auditText = await new Response(auditProcess.stdout).text()
const auditExit = await auditProcess.exited

if (!auditText.trim()) {
  throw new Error(`bun audit produced no JSON (exit ${auditExit})`)
}

const audit = JSON.parse(auditText) as Record<string, AuditAdvisory[]>
const relevant = Object.entries(audit).flatMap(([packageName, advisories]) =>
  advisories
    .filter(({ severity }) => severity === "high" || severity === "critical")
    .map((advisory) => ({ ...advisory, packageName }))
)

const flattened = triage.entries.flatMap((entry) =>
  entry.ids.map((id) => ({ id, entry }))
)
const triageById = new Map(flattened.map(({ id, entry }) => [id, entry]))
const auditIds = new Set(relevant.map(({ id }) => id))
const errors: string[] = []

for (const advisory of relevant) {
  const entry = triageById.get(advisory.id)
  if (!entry) {
    errors.push(
      `untriaged ${advisory.severity} advisory ${advisory.id} (${advisory.packageName})`
    )
    continue
  }
  if (
    entry.package !== advisory.packageName ||
    entry.severity !== advisory.severity
  ) {
    errors.push(`triage metadata mismatch for advisory ${advisory.id}`)
  }
  if (entry.rationale.trim().length < 40) {
    errors.push(`triage rationale is too short for advisory ${advisory.id}`)
  }
  if (
    advisory.severity === "critical" &&
    entry.classification === "runtime" &&
    entry.decision !== "mitigated"
  ) {
    errors.push(`unmitigated critical runtime advisory ${advisory.id}`)
  }
}

for (const { id } of flattened) {
  if (!auditIds.has(id)) {
    errors.push(
      `stale triage entry ${id}; remove it after confirming remediation`
    )
  }
}

const reviewDeadline = Date.parse(`${triage.reviewBy}T23:59:59Z`)
if (!Number.isFinite(reviewDeadline) || Date.now() > reviewDeadline) {
  errors.push(`advisory triage review expired on ${triage.reviewBy}`)
}

if (errors.length > 0) {
  for (const error of errors) console.error(`dependency-audit: ${error}`)
  process.exit(1)
}

console.log(
  `Dependency audit gate passed: ${relevant.length} high/critical advisories are documented; no exploitable critical runtime advisory is accepted.`
)
