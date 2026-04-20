// SPDX-License-Identifier: AGPL-3.0-only

export interface ParsedEnvEntry {
  key: string
  value: string
  /** 1-based line number in the source where the entry starts. */
  line: number
}

export interface ParseEnvError {
  line: number
  message: string
  raw: string
}

export interface ParseEnvResult {
  entries: Array<ParsedEnvEntry>
  errors: Array<ParseEnvError>
}

const KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/

export function parseDotenv(input: string): ParseEnvResult {
  const entries: Array<ParsedEnvEntry> = []
  const errors: Array<ParseEnvError> = []
  const seenKeys = new Map<string, number>()

  const lines = input.replace(/\r\n/g, "\n").split("\n")

  let i = 0
  while (i < lines.length) {
    const lineNo = i + 1
    const raw = lines[i]
    const trimmed = raw.trim()

    if (trimmed === "" || trimmed.startsWith("#")) {
      i++
      continue
    }

    const withoutExport = trimmed.replace(/^export\s+/, "")
    const eq = withoutExport.indexOf("=")
    if (eq === -1) {
      errors.push({ line: lineNo, message: "Missing '='", raw })
      i++
      continue
    }

    const key = withoutExport.slice(0, eq).trim()
    if (!KEY_REGEX.test(key)) {
      errors.push({ line: lineNo, message: `Invalid key "${key}"`, raw })
      i++
      continue
    }

    let rest = withoutExport.slice(eq + 1)
    let value = ""
    const startLine = lineNo

    const firstChar = rest.trimStart()[0]
    if (firstChar === '"' || firstChar === "'") {
      const quote = firstChar
      rest = rest.trimStart().slice(1)
      const collected: Array<string> = []
      let closed = false

      for (;;) {
        const idx = findUnescapedQuote(rest, quote)
        if (idx !== -1) {
          collected.push(rest.slice(0, idx))
          closed = true
          break
        }
        collected.push(rest)
        i++
        if (i >= lines.length) break
        collected.push("\n")
        rest = lines[i]
      }

      if (!closed) {
        errors.push({
          line: startLine,
          message: `Unterminated ${quote === '"' ? "double" : "single"}-quoted value`,
          raw,
        })
        i++
        continue
      }

      value = collected.join("")
      if (quote === '"') {
        value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\")
      } else {
        value = value.replace(/\\'/g, "'").replace(/\\\\/g, "\\")
      }
      i++
    } else {
      const hashIdx = findInlineComment(rest)
      if (hashIdx !== -1) rest = rest.slice(0, hashIdx)
      value = rest.trim()
      i++
    }

    if (seenKeys.has(key)) {
      const existingIdx = seenKeys.get(key)!
      entries[existingIdx] = { key, value, line: startLine }
    } else {
      seenKeys.set(key, entries.length)
      entries.push({ key, value, line: startLine })
    }
  }

  return { entries, errors }
}

function findUnescapedQuote(s: string, quote: string): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\") {
      i++
      continue
    }
    if (s[i] === quote) return i
  }
  return -1
}

function findInlineComment(s: string): number {
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === "#" && (i === 0 || /\s/.test(s[i - 1]))) return i
  }
  return -1
}

export function looksSecret(key: string): boolean {
  const k = key.toUpperCase()
  return (
    k.includes("SECRET") ||
    k.includes("TOKEN") ||
    k.includes("PASSWORD") ||
    k.includes("PASS") ||
    k.includes("KEY") ||
    k.includes("PRIVATE") ||
    k.endsWith("_DSN") ||
    k.includes("API_KEY") ||
    k.includes("CREDENTIAL")
  )
}
