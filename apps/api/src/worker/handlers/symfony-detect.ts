// SPDX-License-Identifier: AGPL-3.0-only
import fs from "node:fs"
import path from "node:path"

type JsonObject = Record<string, unknown>

export async function isSymfonyFlexWorkspace(root: string): Promise<boolean> {
  const composerJson = await readJsonObject(path.join(root, "composer.json"))
  if (!composerJson) return false

  const scripts = asObject(composerJson["scripts"])
  if (asObject(scripts?.["auto-scripts"])) return true

  const extra = asObject(composerJson["extra"])
  if (asObject(extra?.["symfony"])) return true

  const require = asObject(composerJson["require"])
  const requireDev = asObject(composerJson["require-dev"])
  return hasAnyPackage(require, requireDev, [
    "symfony/flex",
    "symfony/framework-bundle",
    "symfony/runtime",
  ])
}

async function readJsonObject(filePath: string): Promise<JsonObject | null> {
  try {
    const raw = await fs.promises.readFile(filePath, "utf8")
    const parsed = JSON.parse(raw)
    return asObject(parsed)
  } catch {
    return null
  }
}

function hasAnyPackage(
  ...args: Array<JsonObject | readonly string[] | null | undefined>
): boolean {
  const packageNames = args.at(-1)
  if (!Array.isArray(packageNames)) return false
  const maps = args.slice(0, -1)
  return maps.some((obj) =>
    packageNames.some(
      (name) => typeof (obj as JsonObject | null)?.[name] === "string"
    )
  )
}

function asObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}
