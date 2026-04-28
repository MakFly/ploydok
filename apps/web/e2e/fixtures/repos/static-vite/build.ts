// SPDX-License-Identifier: AGPL-3.0-only
import { mkdir, writeFile } from "node:fs/promises"

await mkdir("dist/assets", { recursive: true })
await writeFile(
  "dist/index.html",
  [
    "<!doctype html>",
    "<html>",
    "<head>",
    "  <meta charset=\"utf-8\">",
    "  <title>Ploydok Static Fixture</title>",
    "  <link rel=\"stylesheet\" href=\"/assets/app.css\">",
    "</head>",
    "<body>",
    "  <main id=\"app\">static-fixture-ok</main>",
    "</body>",
    "</html>",
    "",
  ].join("\n")
)
await writeFile(
  "dist/assets/app.css",
  "body{font-family:system-ui,sans-serif}#app{color:#123456}\n"
)
