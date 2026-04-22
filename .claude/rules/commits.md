# Commits & PRs

## DCO obligatoire

```bash
git commit -s -m "feat(auth): rotate refresh on use"
```

Le `-s` ajoute `Signed-off-by:` — **sans ça, la CI bloque** (cf. `.github/workflows/*`). Pas de `--no-verify`, pas de `-S` qui skip.

## Conventional Commits

Format : `<type>(<scope>): <subject>`

Types : `feat` · `fix` · `chore` · `docs` · `refactor` · `test` · `ci` · `perf` · `build` · `style`

Scopes usuels : `api`, `web`, `db`, `ui`, `shared`, `agent`, `infra`, `auth`, `ci`, `lint`, `sprint-N`.

- Sujet : impératif présent, minuscule, pas de point final, ≤ 72 chars.
- Un commit = un changement focalisé. Si le diff touche 3 sujets, 3 commits.
- `fix:` = bug réel. `chore:` = tooling/deps. Ne pas mentir sur le type.

## SPDX

Tout nouveau fichier `.ts|.tsx|.rs` commence par :
```
// SPDX-License-Identifier: AGPL-3.0-only
```
(voir `testing.md` § SPDX).

## Avant commit

```bash
bun run typecheck && bun run lint && bun test && bun run check:spdx
```

## Règles dures

- **Jamais** `git push` sans autorisation explicite utilisateur.
- **Jamais** push sur `main` en force. Pour n'importe quelle branche : demander.
- **Jamais** skip hooks (`--no-verify`, `--no-gpg-sign`) — investiguer la cause du fail.
- **Jamais** amender un commit déjà poussé.
- **Jamais** `git add -A` / `git add .` — lister les fichiers (risque de commiter `.env.local`, `test-results/`, dumps Postgres).

## PR

- Titre = sujet du commit principal (≤ 70 chars).
- Description : `## Summary` + `## Test plan` (checklist).
- Référencer le sprint : `Refs docs/sprints/sprint-N-*.md`.
- CI doit être verte avant review : lint + typecheck + test + spdx + dco.
