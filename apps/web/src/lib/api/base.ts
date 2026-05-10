// SPDX-License-Identifier: AGPL-3.0-only

export function apiBaseUrl(): string {
  if (typeof window !== "undefined") {
    return (
      import.meta.env.VITE_API_URL ??
      (import.meta.env.PROD ? "/api" : "http://localhost:3335")
    )
  }

  return (
    process.env["PLOYDOK_API_URL"] ??
    import.meta.env.VITE_API_URL ??
    (import.meta.env.PROD ? "http://api:3335" : "http://localhost:3335")
  )
}

export function apiWebSocketBaseUrl(): string {
  const base = apiBaseUrl()
  if (base.startsWith("https://")) return base.replace(/^http/, "ws")
  if (base.startsWith("http://")) return base.replace(/^http/, "ws")
  return base
}
