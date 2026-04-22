# Sprints — Ploydok

Roadmap **7 sprints d'1 semaine** pour atteindre la v1.0.

| # | Statut | Sprint | Objectif | Deliverable clé |
|---|---|---|---|---|
| 1 | ✅ Terminé | [Fondations](./sprint-1-fondations.md) | Monorepo + auth passkey | Login passkey fonctionnel |
| 2 | ✅ Terminé | [Agent + Caddy](./sprint-2-agent-caddy.md) | Isolation Docker via agent Rust | Spawn nginx via gRPC |
| 3 | ✅ Code · ⏳ e2e | [Deploy from Git](./sprint-3-deploy-from-git.md) | Pipeline GitHub → app live, zero-downtime, build cache, monorepo | Deploy Next.js < 2 min, 0 5xx |
| 3bis | ✅ Code · ⏳ e2e GitLab (standby) | [Multi-source & quotas](./sprint-3bis-multi-source-quotas.md) | GitHub focus, GitLab en standby, image Docker + quotas + net isolation stricte (Gitea hors scope) | Zero-trust cross-project : 2/2 e2e verts, OOM validé, surpasse Dokploy/Coolify |
| 3.1.1 | ✅ Terminé | [Webhook auto-deploy](./sprint-3.1.1-webhook-autodeploy.md) | push → build → live automatique, deliveries audit, coalescing, previews PR, notifs | Parité Dokploy/Coolify sur boucle auto-deploy |
| 4 | ⏳ À faire | [Secrets / Domaines / DB](./sprint-4-secrets-domaines-db.md) | Scopes env vars, wildcard TLS, deploy hooks, DB | App + Postgres + wildcard + migrations |
| 5 | ⏳ À faire | [Copilot IA](./sprint-5-copilot-readonly.md) | Diagnostic & génération (read-only) | Chat qui debug une app cassée |
| 6 | ⏳ À faire | [Hardening & Release](./sprint-6-hardening-release.md) | API tokens, terminal web, monitoring hôte, install + tests 7 niveaux | `curl install.ploydok.dev \| bash` |

Audit détaillé : `docs/plans/PLAN-sprint-3-closure.md` + `docs/plans/PLAN-sprint-3-closure-3bis-pg.md` (2026-04-20).

## Docs transverses
- [PRD complet](../PRD.md)
- [Stratégie d'installation](../install-strategy.md) — gestion conflits nginx/apache2, modes takeover/coexist/abort
- [Stratégie de tests](../testing-strategy.md) — 7 niveaux de tests + matrice install + backup/DR
- [Gap analysis](../gap-analysis.md) — audit vs Dokploy/Coolify/Vercel, 17 gaps + priorisation
