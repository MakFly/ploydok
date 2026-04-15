# Sprints — Ploydok

Roadmap **7 sprints d'1 semaine** pour atteindre la v1.0.

| # | Sprint | Objectif | Deliverable clé |
|---|---|---|---|
| 1 | [Fondations](./sprint-1-fondations.md) | Monorepo + auth passkey | Login passkey fonctionnel |
| 2 | [Agent + Caddy](./sprint-2-agent-caddy.md) | Isolation Docker via agent Rust | Spawn nginx via gRPC |
| 3 | [Deploy from Git](./sprint-3-deploy-from-git.md) | Pipeline GitHub → app live, zero-downtime, build cache, monorepo | Deploy Next.js < 2 min, 0 5xx |
| 3bis | [Multi-source & quotas](./sprint-3bis-multi-source-quotas.md) | GitLab/Gitea + image Docker + ressource limits | Gitea deploy + Plausible + OOM isolé |
| 4 | [Secrets / Domaines / DB](./sprint-4-secrets-domaines-db.md) | Scopes env vars, wildcard TLS, deploy hooks, DB | App + Postgres + wildcard + migrations |
| 5 | [Copilot IA](./sprint-5-copilot-readonly.md) | Diagnostic & génération (read-only) | Chat qui debug une app cassée |
| 6 | [Hardening & Release](./sprint-6-hardening-release.md) | API tokens, terminal web, monitoring hôte, install + tests 7 niveaux | `curl install.ploydok.dev \| bash` |

## Docs transverses
- [PRD complet](../PRD.md)
- [Stratégie d'installation](../install-strategy.md) — gestion conflits nginx/apache2, modes takeover/coexist/abort
- [Stratégie de tests](../testing-strategy.md) — 7 niveaux de tests + matrice install + backup/DR
- [Gap analysis](../gap-analysis.md) — audit vs Dokploy/Coolify/Vercel, 17 gaps + priorisation
