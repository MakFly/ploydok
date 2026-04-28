#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-only

import { auditApp } from "./index"

const rootDir = Bun.argv[2] ?? process.cwd()
const includeDetails = !Bun.argv.includes("--no-details")

const report = await auditApp({ rootDir, includeDetails })
console.log(JSON.stringify(report, null, 2))

if (report.matches.length > 0) {
  process.exitCode = 1
}
