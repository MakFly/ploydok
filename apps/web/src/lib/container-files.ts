// SPDX-License-Identifier: AGPL-3.0-only
import { apiFetch } from "./api"
import type {
  FileEntry,
  ListFilesResponse,
  ReadFileResponse,
} from "@ploydok/shared"

export type { FileEntry, ListFilesResponse, ReadFileResponse }

export async function listContainerFiles(
  appId: string,
  path: string,
  showHidden = false
): Promise<ListFilesResponse> {
  const params = new URLSearchParams({ path })
  if (showHidden) params.set("show_hidden", "1")
  return apiFetch<ListFilesResponse>(`/apps/${appId}/files?${params}`)
}

export async function readContainerFile(
  appId: string,
  path: string
): Promise<ReadFileResponse> {
  const params = new URLSearchParams({ path })
  return apiFetch<ReadFileResponse>(`/apps/${appId}/files/content?${params}`)
}

// Decode the API's base64 payload into UTF-8 text. Returns null if the bytes
// don't decode cleanly — callers fall back to a binary placeholder.
export function decodeFileContent(b64: string): string | null {
  try {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes)
  } catch {
    return null
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
