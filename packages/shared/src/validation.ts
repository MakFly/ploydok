// SPDX-License-Identifier: AGPL-3.0-only
import type { ZodError } from "zod"

// Zod sérialise ses erreurs en JSON brut : `error.message` renvoie le tableau
// d'issues complet, illisible dans une alerte. Ces deux helpers en tirent la
// forme attendue par les surfaces — un message par champ, et un résumé.

/** Première erreur par champ, indexée sur son chemin (`password`, `a.b`). */
export function fieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    // Chemin vide = erreur au niveau de l'objet (refine croisé sans `path`).
    const key = issue.path.length > 0 ? issue.path.join(".") : "_"
    if (!(key in out)) out[key] = issue.message
  }
  return out
}

/** Résumé d'une page : la première erreur, dans l'ordre du schéma. */
export function firstErrorMessage(
  error: ZodError,
  fallback = "Invalid input"
): string {
  return error.issues[0]?.message ?? fallback
}
