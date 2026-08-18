// SPDX-License-Identifier: AGPL-3.0-only
import { Glob } from "bun"
import { readFile } from "node:fs/promises"

const PLACEHOLDER_ASSERTION = /expect\s*\(\s*true\s*\)\s*\.toBe\s*\(\s*true\s*\)/

export async function findPlaceholderTests(root = process.cwd()): Promise<Array<string>> {
  const matches: Array<string> = []
  const glob = new Glob("{apps,packages}/**/*.test.{ts,tsx}")

  for await (const path of glob.scan({ cwd: root, absolute: false })) {
    if (path.includes("/node_modules/") || path.includes("/dist/")) continue
    const source = await readFile(`${root}/${path}`, "utf8")
    if (PLACEHOLDER_ASSERTION.test(source)) matches.push(path)
  }

  return matches.sort()
}

if (import.meta.main) {
  const matches = await findPlaceholderTests()
  if (matches.length === 0) {
    console.log("check-test-placeholders: no tautological test assertions")
    process.exit(0)
  }

  console.error("check-test-placeholders: replace or remove false test claims:")
  for (const path of matches) console.error(`  - ${path}`)
  process.exit(1)
}
