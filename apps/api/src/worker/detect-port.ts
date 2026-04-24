// SPDX-License-Identifier: AGPL-3.0-only
import { readFile } from "node:fs/promises";

/**
 * Parse the first EXPOSE instruction of a Dockerfile and return the port.
 *
 * Dockerfile EXPOSE syntax accepts:
 *   EXPOSE 8080
 *   EXPOSE 8080/tcp
 *   EXPOSE 80 443
 *   EXPOSE ${PORT}       (not resolvable statically — we ignore those)
 *
 * We return the first numeric port we find. If none is resolvable, return null.
 * Caller decides whether to fall back to a hardcoded default.
 *
 * Kept deliberately minimal: no ARG/ENV interpolation, no multi-stage hunt,
 * no compose parsing. The goal is to avoid hardcoding 3000 when the user's
 * image clearly declares another port.
 */
export async function detectDockerfilePort(dockerfilePath: string): Promise<number | null> {
  let content: string;
  try {
    content = await readFile(dockerfilePath, "utf8");
  } catch {
    return null;
  }
  return detectDockerfilePortFromString(content);
}

export function detectDockerfilePortFromString(dockerfile: string): number | null {
  const lines = dockerfile.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line.toUpperCase().startsWith("EXPOSE ")) continue;
    const args = line.slice("EXPOSE ".length).trim();
    // Pick the first token that is a pure decimal port (optionally /tcp or /udp).
    for (const tok of args.split(/\s+/)) {
      const m = tok.match(/^(\d{2,5})(?:\/(?:tcp|udp))?$/i);
      if (!m) continue;
      const port = Number.parseInt(m[1]!, 10);
      if (port >= 1 && port <= 65535) return port;
    }
  }
  return null;
}
