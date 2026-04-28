// SPDX-License-Identifier: AGPL-3.0-only

import { readdir, readFile } from "node:fs/promises"
import { basename, join, relative } from "node:path"
import type {
  CollectManifestOptions,
  DependencyEcosystem,
  FoundDependency,
  ManifestKind,
  ManifestSnapshot,
} from "./types"

const IGNORED_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  ".venv",
  "__pycache__",
  "build",
  "dist",
  "node_modules",
  "target",
  "vendor",
  "venv",
])

const SUPPORTED_MANIFESTS = new Set([
  "package-lock.json",
  "package.json",
  "bun.lock",
  "Cargo.lock",
  "composer.lock",
  "requirements.txt",
])

interface ManifestFile {
  absPath: string
  relPath: string
  name: string
}

export async function collectManifestDependencies(
  rootDir: string,
  options: CollectManifestOptions = {},
): Promise<ManifestSnapshot[]> {
  const files = await findManifestFiles(rootDir, options.maxDepth ?? 6)
  const lockDirs = new Set(
    files
      .filter((file) => file.name === "package-lock.json" || file.name === "bun.lock")
      .map((file) => file.relPath.slice(0, -file.name.length)),
  )
  const snapshots: ManifestSnapshot[] = []

  for (const file of files) {
    if (file.name === "package.json" && lockDirs.has(file.relPath.slice(0, -file.name.length))) {
      continue
    }

    const text = await readFile(file.absPath, "utf8")
    const dependencies = parseManifest(file.relPath, file.name, text, options)
    if (dependencies.length > 0) {
      snapshots.push({
        path: file.relPath,
        kind: dependencies[0]?.manifestKind ?? manifestKindForName(file.name),
        dependencies,
      })
    }
  }

  return snapshots
}

async function findManifestFiles(rootDir: string, maxDepth: number): Promise<ManifestFile[]> {
  const results: ManifestFile[] = []

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return

    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const absPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          await walk(absPath, depth + 1)
        }
        continue
      }

      if (entry.isFile() && SUPPORTED_MANIFESTS.has(entry.name)) {
        results.push({
          absPath,
          relPath: relative(rootDir, absPath),
          name: entry.name,
        })
      }
    }
  }

  await walk(rootDir, 0)
  return results.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

function parseManifest(
  manifestPath: string,
  fileName: string,
  text: string,
  options: CollectManifestOptions,
): FoundDependency[] {
  switch (fileName) {
    case "package-lock.json":
      return parsePackageLock(manifestPath, text, options)
    case "bun.lock":
      return parseBunLock(manifestPath, text)
    case "package.json":
      return parsePackageJson(manifestPath, text, options)
    case "Cargo.lock":
      return parseCargoLock(manifestPath, text)
    case "composer.lock":
      return parseComposerLock(manifestPath, text, options)
    case "requirements.txt":
      return parseRequirements(manifestPath, text)
    default:
      return []
  }
}

function parsePackageLock(
  manifestPath: string,
  text: string,
  options: CollectManifestOptions,
): FoundDependency[] {
  const parsed = parseJsonObject(text)
  const packages = getRecord(parsed["packages"])
  const dependencies: FoundDependency[] = []

  for (const [pkgPath, value] of Object.entries(packages)) {
    if (!pkgPath.startsWith("node_modules/")) continue
    const pkg = getRecord(value)
    const version = getString(pkg["version"])
    if (!version) continue
    const dev = Boolean(pkg["dev"])
    if (dev && options.includeDevDependencies === false) continue

    dependencies.push(makeDependency("npm", packageNameFromNodeModulesPath(pkgPath), version, manifestPath, "package-lock", dev))
  }

  return dedupeDependencies(dependencies)
}

function parseBunLock(manifestPath: string, text: string): FoundDependency[] {
  const dependencies: FoundDependency[] = []
  const packageLine = /^\s*"([^"]+)":\s*\[\s*"([^"]+)"/gm

  for (const match of text.matchAll(packageLine)) {
    const name = match[1]
    const spec = match[2]
    if (!name || !spec || !spec.startsWith(`${name}@`)) continue

    const version = spec.slice(name.length + 1)
    if (!isConcreteVersion(version)) continue
    dependencies.push(makeDependency("npm", name, version, manifestPath, "bun-lock", false))
  }

  return dedupeDependencies(dependencies)
}

function parsePackageJson(
  manifestPath: string,
  text: string,
  options: CollectManifestOptions,
): FoundDependency[] {
  const parsed = parseJsonObject(text)
  const dependencies: FoundDependency[] = []

  collectPackageJsonSection(dependencies, parsed["dependencies"], manifestPath, false)
  collectPackageJsonSection(dependencies, parsed["optionalDependencies"], manifestPath, false)
  collectPackageJsonSection(dependencies, parsed["peerDependencies"], manifestPath, false)

  if (options.includeDevDependencies !== false) {
    collectPackageJsonSection(dependencies, parsed["devDependencies"], manifestPath, true)
  }

  return dedupeDependencies(dependencies)
}

function collectPackageJsonSection(
  dependencies: FoundDependency[],
  value: unknown,
  manifestPath: string,
  dev: boolean,
): void {
  for (const [name, versionRange] of Object.entries(getRecord(value))) {
    const version = normalizeExactNpmVersion(getString(versionRange))
    if (!version) continue
    dependencies.push(makeDependency("npm", name, version, manifestPath, "package-json", dev))
  }
}

function parseCargoLock(manifestPath: string, text: string): FoundDependency[] {
  const dependencies: FoundDependency[] = []
  const blocks = text.split(/\n(?=\[\[package\]\])/)

  for (const block of blocks) {
    if (!block.includes("[[package]]")) continue
    const name = block.match(/^name = "([^"]+)"/m)?.[1]
    const version = block.match(/^version = "([^"]+)"/m)?.[1]
    if (name && version) {
      dependencies.push(makeDependency("crates.io", name, version, manifestPath, "cargo-lock", false))
    }
  }

  return dedupeDependencies(dependencies)
}

function parseComposerLock(
  manifestPath: string,
  text: string,
  options: CollectManifestOptions,
): FoundDependency[] {
  const parsed = parseJsonObject(text)
  const dependencies: FoundDependency[] = []

  collectComposerPackages(dependencies, parsed["packages"], manifestPath, false)
  if (options.includeDevDependencies !== false) {
    collectComposerPackages(dependencies, parsed["packages-dev"], manifestPath, true)
  }

  return dedupeDependencies(dependencies)
}

function collectComposerPackages(
  dependencies: FoundDependency[],
  value: unknown,
  manifestPath: string,
  dev: boolean,
): void {
  if (!Array.isArray(value)) return

  for (const item of value) {
    const pkg = getRecord(item)
    const name = getString(pkg["name"])
    const version = normalizeComposerVersion(getString(pkg["version"]))
    if (name && version) {
      dependencies.push(makeDependency("Packagist", name, version, manifestPath, "composer-lock", dev))
    }
  }
}

function parseRequirements(manifestPath: string, text: string): FoundDependency[] {
  const dependencies: FoundDependency[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "").trim()
    if (!line || line.startsWith("#") || line.startsWith("-")) continue

    const match = line.match(/^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?\s*(?:==|===)\s*([A-Za-z0-9_.!+-]+)$/)
    if (!match?.[1] || !match[2]) continue
    dependencies.push(makeDependency("PyPI", normalizePypiName(match[1]), match[2], manifestPath, "requirements", false))
  }

  return dedupeDependencies(dependencies)
}

function makeDependency(
  ecosystem: DependencyEcosystem,
  name: string,
  version: string,
  manifestPath: string,
  manifestKind: ManifestKind,
  dev: boolean,
): FoundDependency {
  return { ecosystem, name, version, manifestPath, manifestKind, dev }
}

function dedupeDependencies(dependencies: FoundDependency[]): FoundDependency[] {
  const seen = new Set<string>()
  const deduped: FoundDependency[] = []

  for (const dependency of dependencies) {
    const key = `${dependency.ecosystem}\0${dependency.name}\0${dependency.version}\0${dependency.manifestPath}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(dependency)
  }

  return deduped.sort((a, b) => `${a.ecosystem}:${a.name}`.localeCompare(`${b.ecosystem}:${b.name}`))
}

function packageNameFromNodeModulesPath(pkgPath: string): string {
  const marker = "node_modules/"
  const tail = pkgPath.slice(pkgPath.lastIndexOf(marker) + marker.length)
  const parts = tail.split("/")
  return parts[0]?.startsWith("@") && parts[1] ? `${parts[0]}/${parts[1]}` : (parts[0] ?? tail)
}

function normalizeExactNpmVersion(version: string | undefined): string | undefined {
  if (!version) return undefined
  const normalized = version.trim()
  if (!isConcreteVersion(normalized)) return undefined
  return normalized
}

function normalizeComposerVersion(version: string | undefined): string | undefined {
  if (!version) return undefined
  const normalized = version.trim().replace(/^v(?=\d)/, "")
  return isConcreteVersion(normalized) ? normalized : undefined
}

function normalizePypiName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-")
}

function isConcreteVersion(version: string): boolean {
  return !/^(workspace:|file:|link:|git\+|github:|npm:|catalog:|\*|latest|[\^~<>=])/.test(version)
}

function manifestKindForName(fileName: string): ManifestKind {
  switch (fileName) {
    case "package-lock.json":
      return "package-lock"
    case "bun.lock":
      return "bun-lock"
    case "package.json":
      return "package-json"
    case "Cargo.lock":
      return "cargo-lock"
    case "composer.lock":
      return "composer-lock"
    case "requirements.txt":
      return "requirements"
    default:
      throw new Error(`Unsupported manifest ${basename(fileName)}`)
  }
}

function parseJsonObject(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text)
  return getRecord(parsed)
}

function getRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}
