# Testing — DoD avant "done"

Rappel CLAUDE.md : **aucun `git push` avant DoD sprint vérifiée bout en bout**. Type-check seul n'est **pas** suffisant.

## Boucle locale obligatoire

```bash
bun run typecheck      # turbo typecheck
bun run lint           # turbo lint (eslint + @tanstack/eslint-config)
bun test               # turbo test (bun test partout)
bun run check:spdx     # headers AGPL-3.0-only
```

Tous verts ⇒ passage possible aux e2e.

## Unit tests (Bun)

- Runner : `bun test` (pas vitest). Fichiers : `*.test.ts` à côté du code.
- Assertions : `expect` de bun. Mocks : `mock.module()` ou injection directe — **pas** de framework de mock lourd.
- API : tester les handlers Hono en montant l'app (`import { app } from "./app"`) et en appelant `app.request(...)`. Voir `apps/api/src/*.test.ts`.
- Web : `@testing-library/react` + `happy-dom`. Le composant doit marcher sans routeur réel quand possible — sinon mock `@tanstack/react-router`.

## E2E (Playwright)

- Config : `apps/web/playwright.config.ts`. Specs : `apps/web/e2e/`.
- `workers: 1`, `fullyParallel: false` — l'auth + la DB SQLite partagée ne tolèrent pas le parallélisme.
- Pré-requis : `make dev` tourne **et** `make infra-up` si le test touche Caddy/BuildKit/Registry.
- Specs Sprint-3 qui spawn des containers : timeout `180_000` ms par `describe`, pas global.
- Lancer : `bun --cwd apps/web exec playwright test` (ajouter `--ui` pour debug).

## E2E API (server.e2e.test.ts)

- `apps/api/src/server.e2e.test.ts` et `apps/api/src/auth/auth.e2e.test.ts` démarrent un vrai serveur Hono sur un port random — garder isolé du runner unit pour ne pas fuiter.

## SPDX

- Tout `.ts`, `.tsx`, `.rs` dans `apps/`, `packages/`, `agent/`, `scripts/` doit commencer par :
  ```ts
  // SPDX-License-Identifier: AGPL-3.0-only
  ```
- Ignorés : `*.gen.ts`, `routeTree.gen.ts`, `target/`, `dist/`, `.turbo/`, `.output/`, `node_modules/`.
- CI bloque sur `bun run check:spdx`.

## Régression UI

Les changements front doivent être testés dans un vrai browser avant "done" (screenshot ou Playwright). Le type-check ne prouve pas qu'un bouton marche.
