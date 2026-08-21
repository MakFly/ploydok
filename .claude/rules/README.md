# Ploydok — `.claude/rules/`

Rules projet. `CLAUDE.md` à la racine est un symlink vers `AGENTS.md` (source unique). Ces fichiers sont des références topiques à consulter quand tu touches un domaine.

| Fichier         | Quand le lire                                                                 |
| --------------- | ----------------------------------------------------------------------------- |
| `commands.md`   | Avant de lancer dev/build/test/infra (make, turbo, bun). Ports réservés.      |
| `monorepo.md`   | Avant d'ajouter un fichier — où vit quoi (`apps/*`, `packages/*`, `agent/*`). |
| `auth.md`       | Toute modif cookies, JWT, WebAuthn, refresh, CSRF, `/me`.                     |
| `db.md`         | Toute modif schema Drizzle, migration Postgres, queries.                      |
| `testing.md`    | Avant de dire "done". Unit (`bun test`) + e2e (Playwright) + SPDX.            |
| `commits.md`    | Avant `git commit`. DCO `-s`, SPDX header, Conventional Commits.              |
| `style.md`      | Prettier, ESLint (`@tanstack/eslint-config`), conventions TS/TSX.             |
| `agent-rust.md` | Toute modif sous `agent/` (Rust, unix socket, gRPC).                          |
| `infra.md`      | Docker Compose (Caddy / BuildKit / Registry), réseau `ploydok-public`.        |
| `i18n.md`       | Toute copy UI dans `apps/web` — `t()`, catalogues EN+FR, pas de littéral.     |

Convention : règles courtes, en français, action-first. Si une règle devient obsolète, **corrige-la** — on fait confiance au repo.
