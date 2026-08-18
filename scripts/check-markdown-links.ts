// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

const result = Bun.spawnSync([
  "git",
  "ls-files",
  "--cached",
  "--others",
  "--exclude-standard",
  "--",
  "*.md",
])

if (result.exitCode !== 0) {
  process.stderr.write(new TextDecoder().decode(result.stderr))
  process.exit(result.exitCode)
}

const markdownFiles = new TextDecoder()
  .decode(result.stdout)
  .split("\n")
  .filter((path) => path.length > 0 && existsSync(path))

const failures: Array<string> = []
const inlineLink = /\[[^\]]*\]\(([^)]+)\)/g

for (const file of markdownFiles) {
  const contents = readFileSync(file, "utf8")
  for (const match of contents.matchAll(inlineLink)) {
    const rawTarget = match[1]?.trim().replace(/^<|>$/g, "") ?? ""
    const target = rawTarget.split("#", 1)[0] ?? ""
    if (
      target.length === 0 ||
      /^(?:https?:|mailto:|tel:|data:)/i.test(target)
    ) {
      continue
    }

    const absolute = resolve(dirname(file), decodeURIComponent(target))
    if (!existsSync(absolute)) {
      const line = contents.slice(0, match.index).split("\n").length
      failures.push(`${file}:${line}: missing local link target ${rawTarget}`)
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"))
  process.exit(1)
}

console.log(`Markdown links OK (${markdownFiles.length} files)`)
