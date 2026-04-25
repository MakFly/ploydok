// SPDX-License-Identifier: AGPL-3.0-only
import { Glob } from "bun"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

const ROOT = process.cwd()

const PATTERNS = [
  "apps/**/*.ts",
  "apps/**/*.tsx",
  "apps/**/*.astro",
  "apps/**/*.mdx",
  "packages/**/*.ts",
  "packages/**/*.tsx",
  "agent/**/*.rs",
  "scripts/**/*.ts",
]

const IGNORE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.turbo/**",
  "**/.output/**",
  "**/.tanstack/**",
  "**/target/**",
  "**/*.gen.ts",
  "**/routeTree.gen.ts",
  "**/src/gen/**",
]

const EXPECTED_TS = "// SPDX-License-Identifier: AGPL-3.0-only"
const EXPECTED_SPDX = "SPDX-License-Identifier: AGPL-3.0-only"

function isIgnored(path: string): boolean {
  return IGNORE.some((pat) => new Glob(pat).match(path))
}

function hasValidSpdxHeader(first: string | null, path: string): boolean {
  if (!first) return false
  if (path.endsWith(".astro") || path.endsWith(".mdx")) {
    return first.includes(EXPECTED_SPDX)
  }
  return first === EXPECTED_TS
}

async function firstMeaningfulLine(path: string): Promise<string | null> {
  const content = await readFile(path, "utf8")
  const lines = content.split("\n")

  // Handle Astro files: look for SPDX inside the --- --- fence (skip first --- line)
  if (path.endsWith(".astro")) {
    let inFence = false
    for (const raw of lines) {
      const line = raw.trim()
      if (!inFence && line === "---") {
        inFence = true
        continue
      }
      if (inFence) {
        if (line.startsWith("// SPDX-License-Identifier:")) {
          return line
        }
        if (line === "---") break // End of frontmatter
      }
    }
    return null
  }

  // Handle MDX files: look for {/* SPDX ... */}
  if (path.endsWith(".mdx")) {
    for (const raw of lines) {
      const line = raw.trim()
      if (line.includes("SPDX-License-Identifier:")) {
        return line
      }
      if (line.startsWith("import ") && !line.includes("SPDX")) break // End of header section
    }
    return null
  }

  // Handle TS/JS/Rust files: normal first line check
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith("#!")) continue
    return line
  }
  return null
}

export async function checkSpdx(root = ROOT): Promise<{
  scanned: number
  violations: string[]
}> {
  const files: string[] = []
  for (const pattern of PATTERNS) {
    const glob = new Glob(pattern)
    for await (const file of glob.scan({ cwd: root, absolute: false })) {
      if (isIgnored(file)) continue
      files.push(file)
    }
  }

  const violations: string[] = []
  for (const rel of files) {
    const abs = join(root, rel)
    let first: string | null
    try {
      first = await firstMeaningfulLine(abs)
    } catch {
      continue
    }
    if (!hasValidSpdxHeader(first, rel)) violations.push(rel)
  }

  return { scanned: files.length, violations }
}

if (import.meta.main) {
  const { scanned, violations } = await checkSpdx()
  if (violations.length === 0) {
    console.log(`check-spdx: ${scanned} files OK`)
    process.exit(0)
  }
  console.error(
    `check-spdx: ${violations.length}/${scanned} files missing SPDX header:`
  )
  for (const f of violations) console.error(`  - ${f}`)
  process.exit(1)
}
