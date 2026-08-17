// SPDX-License-Identifier: AGPL-3.0-only

export function isAllowedNestedProviderFilePath(
  filePath: string,
  allowedFileNames: ReadonlyArray<string>
): boolean {
  if (
    filePath.length === 0 ||
    filePath.length > 512 ||
    filePath.startsWith("/") ||
    filePath.includes("\\") ||
    filePath.includes("\0")
  ) {
    return false
  }

  const segments = filePath.split("/")
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    return false
  }

  return allowedFileNames.includes(segments.at(-1) ?? "")
}
