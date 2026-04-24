// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Names that recipes treat as a "production build" — i.e. composer `--no-dev`,
 * APP_DEBUG=0, opcache frozen, etc. Everything else falls back to the
 * "non-production" branch (dev tooling installed, debug on, opcache validates).
 *
 * The raw `appEnv` string is still forwarded to the container's APP_ENV /
 * NODE_ENV env var — this helper only decides the build-time posture.
 */
const PRODUCTION_ALIASES = new Set<string>([
  "prod",
  "production",
  "live",
]);

export function isProductionAppEnv(appEnv: string | undefined | null): boolean {
  if (appEnv === undefined || appEnv === null || appEnv.trim() === "") {
    // Unspecified → safe default is production posture.
    return true;
  }
  return PRODUCTION_ALIASES.has(appEnv.trim().toLowerCase());
}
