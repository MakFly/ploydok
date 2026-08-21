// SPDX-License-Identifier: AGPL-3.0-only

import type { Resource, ResourceLanguage } from "i18next"

function byNamespace(modules: Record<string, unknown>): ResourceLanguage {
  return Object.fromEntries(
    Object.entries(modules).map(([path, dict]) => [
      path.slice(path.lastIndexOf("/") + 1, -".json".length),
      dict,
    ])
  ) as ResourceLanguage
}

function fileUrlToPath(url: string): string {
  return decodeURIComponent(new URL(url).pathname)
}

function loadFromDisk(): Resource {
  const requireFs = (
    import.meta as ImportMeta & {
      require?: (id: string) => typeof import("node:fs")
    }
  ).require
  if (typeof requireFs !== "function") {
    throw new Error("i18n catalogs: filesystem loader is unavailable")
  }
  const { readdirSync, readFileSync } = requireFs("node:fs")
  const { join } = requireFs("node:path") as typeof import("node:path")

  const readLang = (lng: "en" | "fr"): ResourceLanguage => {
    const dir = fileUrlToPath(
      new URL(`../../locales/${lng}/`, import.meta.url).href
    )
    const modules: Record<string, unknown> = {}
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue
      modules[join(dir, file)] = JSON.parse(
        readFileSync(join(dir, file), "utf8")
      ) as unknown
    }
    return byNamespace(modules)
  }

  return { en: readLang("en"), fr: readLang("fr") }
}

function loadFromGlob(): Resource {
  const en = import.meta.glob("../../locales/en/*.json", {
    eager: true,
    import: "default",
  })
  const fr = import.meta.glob("../../locales/fr/*.json", {
    eager: true,
    import: "default",
  })
  return { en: byNamespace(en), fr: byNamespace(fr) }
}

function isBunRuntime(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== "undefined"
}

/** Vite inlines `import.meta.glob`; bun tests read the JSON files from disk. */
export function loadResources(): Resource {
  return isBunRuntime() ? loadFromDisk() : loadFromGlob()
}

export function loadLocaleModules(
  lng: "en" | "fr"
): Map<string, unknown> {
  const resources = loadResources()
  const lang = resources[lng] ?? {}
  return new Map(
    Object.entries(lang).map(([ns, dict]) => [`${ns}.json`, dict])
  )
}
