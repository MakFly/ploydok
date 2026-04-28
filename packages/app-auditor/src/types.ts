// SPDX-License-Identifier: AGPL-3.0-only

export type DependencyEcosystem = "npm" | "crates.io" | "Packagist" | "PyPI"

export type ManifestKind =
  | "package-json"
  | "package-lock"
  | "bun-lock"
  | "cargo-lock"
  | "composer-lock"
  | "requirements"

export interface FoundDependency {
  ecosystem: DependencyEcosystem
  name: string
  version: string
  manifestPath: string
  manifestKind: ManifestKind
  dev: boolean
}

export interface ManifestSnapshot {
  path: string
  kind: ManifestKind
  dependencies: FoundDependency[]
}

export interface CollectManifestOptions {
  includeDevDependencies?: boolean
  maxDepth?: number
}

export interface OsvPackageQuery {
  package: {
    ecosystem: DependencyEcosystem
    name: string
  }
  version: string
  page_token?: string
}

export interface OsvVulnerabilitySummary {
  id: string
  modified: string
}

export interface OsvQueryResult {
  vulns?: OsvVulnerabilitySummary[]
  next_page_token?: string
}

export interface OsvVulnerabilityDetail {
  id: string
  modified?: string
  published?: string
  withdrawn?: string
  aliases?: string[]
  summary?: string
  details?: string
  severity?: Array<{
    type: string
    score: string
  }>
  affected?: unknown[]
  references?: Array<{
    type?: string
    url: string
  }>
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface QueryOsvOptions {
  baseUrl?: string
  fetchImpl?: FetchLike
  batchSize?: number
}

export interface AuditAppOptions extends CollectManifestOptions, QueryOsvOptions {
  rootDir: string
  includeDetails?: boolean
}

export interface AuditMatch {
  dependency: FoundDependency
  vulnerabilities: OsvVulnerabilitySummary[]
}

export interface AuditReport {
  rootDir: string
  generatedAt: string
  manifests: ManifestSnapshot[]
  dependencyCount: number
  matches: AuditMatch[]
  vulnerabilityDetails: Record<string, OsvVulnerabilityDetail>
}
