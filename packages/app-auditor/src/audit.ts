// SPDX-License-Identifier: AGPL-3.0-only

import { collectManifestDependencies } from "./manifests"
import { dependencyQueryKey, fetchOsvVulnerability, queryOsvForDependencies } from "./osv"
import type { AuditAppOptions, AuditMatch, AuditReport, OsvVulnerabilityDetail } from "./types"

export async function auditApp(options: AuditAppOptions): Promise<AuditReport> {
  const manifests = await collectManifestDependencies(options.rootDir, options)
  const dependencies = manifests.flatMap((manifest) => manifest.dependencies)
  const osvResults = await queryOsvForDependencies(dependencies, options)
  const matches: AuditMatch[] = []

  for (const dependency of dependencies) {
    const result = osvResults.get(dependencyQueryKey(dependency))
    const vulnerabilities = result?.vulns ?? []
    if (vulnerabilities.length === 0) continue
    matches.push({ dependency, vulnerabilities })
  }

  const vulnerabilityDetails = options.includeDetails === false ? {} : await fetchDetails(matches, options)

  return {
    rootDir: options.rootDir,
    generatedAt: new Date().toISOString(),
    manifests,
    dependencyCount: dependencies.length,
    matches,
    vulnerabilityDetails,
  }
}

async function fetchDetails(
  matches: AuditMatch[],
  options: AuditAppOptions,
): Promise<Record<string, OsvVulnerabilityDetail>> {
  const ids = new Set(matches.flatMap((match) => match.vulnerabilities.map((vulnerability) => vulnerability.id)))
  const details: Record<string, OsvVulnerabilityDetail> = {}

  for (const id of ids) {
    details[id] = await fetchOsvVulnerability(id, options)
  }

  return details
}
