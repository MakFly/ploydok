// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Detects the most appropriate editor language for an env var value.
 *
 * Rules (evaluated in order, first match wins):
 *  1. JSON: trimmed value starts with `{` or `[`
 *  2. YAML: starts with `---`, or has a line matching `key: value`
 *  3. Shell: contains a shebang or `export ` statement
 *  4. Certificate / PEM: starts with `-----BEGIN`
 *  5. Default: plaintext
 */
export function detectLanguage(
  value: string,
): "json" | "yaml" | "shell" | "plaintext" {
  const trimmed = value.trimStart()

  // JSON — starts with { or [
  if (/^\s*[{[]/.test(trimmed)) {
    // Quick sanity: try to parse it. If it fails, fall through.
    try {
      JSON.parse(value)
      return "json"
    } catch {
      // not valid JSON — fall through
    }
  }

  // PEM / certificate block — must be checked before YAML since the header
  // line contains dashes that could otherwise trigger the YAML heuristic.
  if (/^-----BEGIN\s/m.test(value)) {
    return "plaintext"
  }

  // YAML — starts with --- or has at least one "key: value" line
  if (/^---/.test(trimmed) || /^[A-Za-z_][A-Za-z0-9_.-]*:\s+\S/m.test(value)) {
    return "yaml"
  }

  // Shell — shebang line or export statement
  if (/^#!/.test(trimmed) || /\bexport\s+[A-Z_]/m.test(value)) {
    return "shell"
  }

  return "plaintext"
}
