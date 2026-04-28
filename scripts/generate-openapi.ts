// SPDX-License-Identifier: AGPL-3.0-only
import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, resolve } from "node:path"
import { app } from "../apps/api/src/app"
import { createOpenApiDocument } from "../apps/api/src/openapi"

const repoRoot = resolve(import.meta.dir, "..")
const outputPath = resolveOutputPath(
  process.env.OPENAPI_OUTPUT ?? "apps/docs/public/openapi.json"
)
const document = createOpenApiDocument(app.routes, "0.1.0")

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8")

console.log(
  `Generated ${outputPath} with ${Object.keys(document.paths).length} paths`
)

process.exit(0)

function resolveOutputPath(path: string): string {
  if (path === "~") return homedir()
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2))
  return resolve(repoRoot, path)
}
