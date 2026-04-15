// SPDX-License-Identifier: AGPL-3.0-only
import { Glob } from "bun";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.cwd();

const PATTERNS = [
  "apps/**/*.ts",
  "apps/**/*.tsx",
  "packages/**/*.ts",
  "packages/**/*.tsx",
  "agent/**/*.rs",
  "scripts/**/*.ts",
];

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
];

const EXPECTED = "// SPDX-License-Identifier: AGPL-3.0-only";

function isIgnored(path: string): boolean {
  return IGNORE.some((pat) => new Glob(pat).match(path));
}

async function firstMeaningfulLine(path: string): Promise<string | null> {
  const content = await readFile(path, "utf8");
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#!")) continue;
    return line;
  }
  return null;
}

export async function checkSpdx(root = ROOT): Promise<{
  scanned: number;
  violations: string[];
}> {
  const files: string[] = [];
  for (const pattern of PATTERNS) {
    const glob = new Glob(pattern);
    for await (const file of glob.scan({ cwd: root, absolute: false })) {
      if (isIgnored(file)) continue;
      files.push(file);
    }
  }

  const violations: string[] = [];
  for (const rel of files) {
    const abs = join(root, rel);
    let first: string | null;
    try {
      first = await firstMeaningfulLine(abs);
    } catch {
      continue;
    }
    if (first !== EXPECTED) violations.push(rel);
  }

  return { scanned: files.length, violations };
}

if (import.meta.main) {
  const { scanned, violations } = await checkSpdx();
  if (violations.length === 0) {
    console.log(`check-spdx: ${scanned} files OK`);
    process.exit(0);
  }
  console.error(
    `check-spdx: ${violations.length}/${scanned} files missing SPDX header:`,
  );
  for (const f of violations) console.error(`  - ${f}`);
  process.exit(1);
}
