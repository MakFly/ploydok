// SPDX-License-Identifier: AGPL-3.0-only

export const NIXPACKS_SUPPORTED_PHP_VERSIONS = [
  "8.1",
  "8.2",
  "8.3",
  "8.4",
] as const

export type NixpacksSupportedPhpVersion =
  (typeof NIXPACKS_SUPPORTED_PHP_VERSIONS)[number]

export const NIXPACKS_SUPPORTED_PHP_VERSIONS_LABEL =
  NIXPACKS_SUPPORTED_PHP_VERSIONS.join(", ")
