# Sprint 3 — Definition of Done

> Auto-générée par `bun scripts/run-dod.ts`. En attente du premier run.

## Résumé

En attente du premier run. Lance `bun scripts/run-dod.ts`.

## Items DoD

| # | DoD | Spec | Durée | Statut | Mesure |
|---|---|---|---|---|---|
| #1 | deploy Next.js via Dockerfile | 01-nextjs-docker.spec.ts | — | ⊘ non exécuté | — |
| #1b | deploy Next.js via Nixpacks | 02-nextjs-nixpacks.spec.ts | — | ⊘ non exécuté | — |
| #2 | deploy FastAPI via Nixpacks | 03-fastapi-nixpacks.spec.ts | — | ⊘ non exécuté | — |
| #3 | deploy monorepo (root_dir) | 04-monorepo.spec.ts | — | ⊘ non exécuté | — |
| #4 | build cache — t2/t1 < 0.40 | 05-build-cache.spec.ts | — | ⊘ non exécuté | — |
| #5 | zero-downtime — 0× 5xx during redeploy | 06-zero-downtime.spec.ts | — | ⊘ non exécuté | — |
| #6 | healthcheck custom | 07-healthcheck-custom.spec.ts | — | ⊘ non exécuté | — |
| #7 | logs latency p95 < 500ms | 08-logs-latency.spec.ts | — | ⊘ non exécuté | — |
| #8 | rollback < 10s | 09-rollback.spec.ts | — | ⊘ non exécuté | — |
| #9 | builds rootless | 10-rootless-audit.spec.ts | — | ⊘ non exécuté | — |
| #10 | cleanup workspace + registry GC | 11-cleanup.spec.ts | — | ⊘ non exécuté | — |

## Commandes pour reproduire

```bash
make infra-up
make dev-agent
make dev
# Install the Ploydok GitHub App on the target account (via /settings/github in the web UI),
# then set apps.github_installation_id on each app (auto at creation, or backfill manually).
PLOYDOK_E2E_REAL=1 bun scripts/run-dod.ts
```
