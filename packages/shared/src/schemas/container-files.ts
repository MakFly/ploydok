// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod"

// One entry in a directory listing returned by GET /apps/:id/files.
export const FileEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  is_dir: z.boolean(),
  is_symlink: z.boolean(),
  size: z.number().int().nonnegative(),
  mode: z.string(),
  mtime: z.number().int(),
  owner: z.string(),
})

export type FileEntry = z.infer<typeof FileEntrySchema>

export const ListFilesResponseSchema = z.object({
  path: z.string(),
  entries: z.array(FileEntrySchema),
})

export type ListFilesResponse = z.infer<typeof ListFilesResponseSchema>

export const ReadFileResponseSchema = z.object({
  path: z.string(),
  content_b64: z.string(),
  total_size: z.number().int().nonnegative(),
  truncated: z.boolean(),
  is_binary: z.boolean(),
})

export type ReadFileResponse = z.infer<typeof ReadFileResponseSchema>

// Path validation shared by API + UI: must be absolute, no traversal segments,
// no NUL bytes, capped length.
export function validateContainerPath(path: string): {
  ok: boolean
  reason?: "not_absolute" | "contains_dotdot" | "contains_nul" | "too_long"
} {
  if (!path.startsWith("/")) return { ok: false, reason: "not_absolute" }
  if (path.includes("\0")) return { ok: false, reason: "contains_nul" }
  if (path.length > 4096) return { ok: false, reason: "too_long" }
  for (const seg of path.split("/")) {
    if (seg === "..") return { ok: false, reason: "contains_dotdot" }
  }
  return { ok: true }
}
