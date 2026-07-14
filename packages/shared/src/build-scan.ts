// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod"

// Latest Trivy image vulnerability scan for an app — contract between the
// API and the web security panel.

export const BuildScanSummarySchema = z.object({
  buildId: z.string(),
  imageRef: z.string().nullable(),
  status: z.enum(["pending", "running", "ok", "skipped", "failed"]),
  critical: z.number().int().nonnegative(),
  high: z.number().int().nonnegative(),
  medium: z.number().int().nonnegative(),
  low: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
  startedAt: z.string().nullable(),
  scannedAt: z.string().nullable(),
})
export type BuildScanSummary = z.infer<typeof BuildScanSummarySchema>
