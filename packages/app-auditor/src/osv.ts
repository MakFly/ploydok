// SPDX-License-Identifier: AGPL-3.0-only

import type {
  FetchLike,
  FoundDependency,
  OsvPackageQuery,
  OsvQueryResult,
  OsvVulnerabilityDetail,
  QueryOsvOptions,
} from "./types"

const DEFAULT_OSV_BASE_URL = "https://api.osv.dev"
const DEFAULT_BATCH_SIZE = 1_000

export async function queryOsvForDependencies(
  dependencies: FoundDependency[],
  options: QueryOsvOptions = {},
): Promise<Map<string, OsvQueryResult>> {
  const baseUrl = options.baseUrl ?? DEFAULT_OSV_BASE_URL
  const fetchImpl = options.fetchImpl ?? fetch
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const results = new Map<string, OsvQueryResult>()
  const uniqueDependencies = dedupeForQuery(dependencies)

  for (let offset = 0; offset < uniqueDependencies.length; offset += batchSize) {
    const batch = uniqueDependencies.slice(offset, offset + batchSize)
    await queryBatchWithPagination(batch, results, { baseUrl, fetchImpl })
  }

  return results
}

export async function fetchOsvVulnerability(
  id: string,
  options: QueryOsvOptions = {},
): Promise<OsvVulnerabilityDetail> {
  const baseUrl = options.baseUrl ?? DEFAULT_OSV_BASE_URL
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(`${baseUrl}/v1/vulns/${encodeURIComponent(id)}`)
  if (!response.ok) {
    throw new Error(`OSV detail request failed for ${id}: HTTP ${response.status}`)
  }

  return (await response.json()) as OsvVulnerabilityDetail
}

async function queryBatchWithPagination(
  dependencies: FoundDependency[],
  results: Map<string, OsvQueryResult>,
  client: { baseUrl: string; fetchImpl: FetchLike },
): Promise<void> {
  let pending: Array<{ dependency: FoundDependency; pageToken?: string }> = dependencies.map((dependency) => ({
    dependency,
  }))

  while (pending.length > 0) {
    const queries: OsvPackageQuery[] = pending.map(({ dependency, pageToken }) => {
      const query: OsvPackageQuery = {
        package: {
          ecosystem: dependency.ecosystem,
          name: dependency.name,
        },
        version: dependency.version,
      }
      if (pageToken) query.page_token = pageToken
      return query
    })

    const response = await client.fetchImpl(`${client.baseUrl}/v1/querybatch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ queries }),
    })
    if (!response.ok) {
      throw new Error(`OSV querybatch failed: HTTP ${response.status}`)
    }

    const body = (await response.json()) as { results?: OsvQueryResult[] }
    const batchResults = body.results ?? []
    const nextPending: Array<{ dependency: FoundDependency; pageToken?: string }> = []

    pending.forEach(({ dependency }, index) => {
      const result = batchResults[index] ?? {}
      const key = dependencyQueryKey(dependency)
      const existing = results.get(key)
      const vulns = [...(existing?.vulns ?? []), ...(result.vulns ?? [])]
      results.set(key, { vulns })

      if (result.next_page_token) {
        nextPending.push({ dependency, pageToken: result.next_page_token })
      }
    })

    pending = nextPending
  }
}

export function dependencyQueryKey(dependency: Pick<FoundDependency, "ecosystem" | "name" | "version">): string {
  return `${dependency.ecosystem}\0${dependency.name}\0${dependency.version}`
}

function dedupeForQuery(dependencies: FoundDependency[]): FoundDependency[] {
  const seen = new Set<string>()
  const deduped: FoundDependency[] = []

  for (const dependency of dependencies) {
    const key = dependencyQueryKey(dependency)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(dependency)
  }

  return deduped
}
