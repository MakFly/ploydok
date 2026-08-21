// SPDX-License-Identifier: AGPL-3.0-only

export const LOCALES = ["en", "fr"] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = "en"
export const LOCALE_COOKIE = "ploydok-locale"

export function isLocale(value: string): value is Locale {
  return value === "en" || value === "fr"
}

/** Map a BCP 47 tag (`fr-FR`, `en`) to a supported locale, or null. */
export function resolveSupportedLocale(
  value: string | null | undefined
): Locale | null {
  if (!value) return null
  const base = value.trim().toLowerCase().split(/[-_]/)[0]
  return isLocale(base) ? base : null
}

/** First supported tag in an Accept-Language header, else the default. */
export function parseAcceptLanguage(
  header: string | null | undefined
): Locale {
  if (!header) return DEFAULT_LOCALE
  const tags = header
    .split(",")
    .map((part) => {
      const [rawTag, rawQ] = part.trim().split(";")
      const tag = rawTag?.trim().toLowerCase() ?? ""
      const quality = rawQ?.trim().toLowerCase().startsWith("q=")
        ? Number(rawQ.trim().slice(2))
        : 1
      return {
        tag,
        quality: Number.isFinite(quality) ? quality : 0,
      }
    })
    .sort((a, b) => b.quality - a.quality)
  for (const { tag } of tags) {
    const resolved = resolveSupportedLocale(tag)
    if (resolved) return resolved
  }
  return DEFAULT_LOCALE
}
