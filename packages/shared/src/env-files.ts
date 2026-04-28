// SPDX-License-Identifier: AGPL-3.0-only

export interface ParsedEnvVar {
  key: string
  value: string
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length < 2) return trimmed

  const quote = trimmed[0]
  if ((quote !== `"` && quote !== "'") || trimmed.at(-1) !== quote) {
    return trimmed
  }

  const inner = trimmed.slice(1, -1)
  if (quote === "'") return inner
  return inner
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, `"`)
    .replace(/\\\\/g, "\\")
}

function stripInlineComment(value: string): string {
  let quote: `"` | "'" | null = null
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    const previous = value[i - 1]
    if ((char === `"` || char === "'") && previous !== "\\") {
      quote = quote === char ? null : quote === null ? char : quote
      continue
    }
    if (char === "#" && quote === null && /\s/.test(previous ?? "")) {
      return value.slice(0, i).trimEnd()
    }
  }
  return value
}

export function parseEnvFile(content: string): Array<ParsedEnvVar> {
  const parsed: Array<ParsedEnvVar> = []
  const byKey = new Map<string, number>()

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue

    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line
    const separator = normalized.indexOf("=")
    if (separator <= 0) continue

    const key = normalized.slice(0, separator).trim()
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue

    const rawValue = stripInlineComment(normalized.slice(separator + 1))
    const value = unquoteEnvValue(rawValue)
    const existingIndex = byKey.get(key)
    if (existingIndex !== undefined) {
      parsed[existingIndex] = { key, value }
      continue
    }
    byKey.set(key, parsed.length)
    parsed.push({ key, value })
  }

  return parsed
}
