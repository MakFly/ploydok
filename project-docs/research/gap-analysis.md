# Gap analysis — Ploydok vs Dokploy / Coolify / Vercel

Audit du plan initial (PRD v0.1) contre les concurrents. 17 gaps identifiés, priorisés, intégrés au planning.

## Matrice des gaps

| # | Gap | Impact | Effort | Sprint cible |
|---|---|---|---|---|
| 1 | Git providers (GitLab, Gitea, Bitbucket) | 🔥 Haut | M | 3 (abstraction) + 3bis (adapters) |
| 2 | Deploy from Docker image | 🔥 Haut | S | 3bis |
| 3 | Ressource quotas (CPU/RAM/PIDs) | 🔥 Haut | S | 3bis |
| 4 | Zero-downtime deploy (blue-green) | 🔥 Haut | M | 3 |
| 5 | Build cache persistant | 🟡 Moyen | S | 3 |
| 6 | Env vars scopées (prod/preview/dev) | 🟡 Moyen | S | 4 |
| 7 | Terminal web exec in-container | 🟡 Moyen | M | 6 |
| 8 | Monorepo subpath + build overrides | 🟡 Moyen | S | 3 |
| 9 | CLI client | 🟡 Moyen | M | v1.1 |
| 10 | API tokens scopés | 🔥 Haut | S | 6 |
| 11 | Logs retention + recherche FTS | 🟡 Moyen | M | v1.1 |
| 12 | Monitoring hôte (disque/RAM VPS) | 🟡 Moyen | S | 6 |
| 13 | Custom healthchecks | 🔥 Haut | S | 3 |
| 14 | Deploy hooks (pre/post) | 🟡 Moyen | S | 4 |
| 15 | Static sites optimisés | ❄ Faible | M | v1.1 |
| 16 | Wildcard TLS via DNS-01 | 🟡 Moyen | M | 4 |
| 17 | Docker Compose multi-services complet | 🟡 Moyen | L | v1.1 |

## Décisions

- **v1.0 (obligatoire)** : gaps 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 13, 14, 16
- **v1.1 (post-launch ≤ 2 mois)** : gaps 9, 11, 15, 17
- Ajout d'un **Sprint 3bis** dédié aux adapters Git + deploy Docker image + quotas → roadmap passe de 6 à 7 sprints

## Impact planning

- Sprints 3, 4, 6 enrichis (voir fichiers respectifs)
- Nouveau Sprint 3bis entre deploy-from-git et secrets/domaines
- Durée totale v1.0 : 7 semaines (vs 6 initialement)

---

## Audit v2 — gaps additionnels (résolus)

7 trous critiques v1.0 supplémentaires identifiés à l'audit v2, tous intégrés :

| # | Gap | Sprint cible |
|---|---|---|
| A1 | Passkey recovery (backup codes + multi-device + CLI admin-recovery) | 1 |
| A2 | Session management UI | 1 |
| A3 | Network isolation par projet | 3bis |
| A4 | Basic Auth / IP allowlist / rate-limit par app | 4 |
| A5 | Import cert TLS manuel | 4 |
| A6 | Registry GC multi-niveau | 3 |
| A7 | Gouvernance repo (LICENSE AGPL-3.0-only, SECURITY.md, DCO, etc.) | 1 |

Reportés v1.1 :

| # | Gap | Rationale |
|---|---|---|
| B1 | Import depuis Dokploy / Coolify | Growth hack, pas bloquant release |
| B2 | Secret groups | Courant mais contournable |
| B3 | Logs drains externes | v1.1 avec retention FTS5 |
| B4 | Export manifest YAML | DR nice-to-have |
| B5 | Accessibilité WCAG 2.1 AA | Audit a11y complet post-v1 |
| B6 | Telemetry opt-in + error tracking | Glitchtip self-hosted en v1.1 |

Reportés v1.5 :
- SSO / OIDC / SAML
- Egress control per-app (firewall sortant)
- i18n
- Custom branding

---

## Décisions sur ambiguïtés (validées)

1. **Licence** : AGPL-3.0-only + DCO + SPDX headers (intégré Sprint 1 §1.7)
2. **Rotation DB** : opt-in 90j défaut, double-write 5 min, blue-green propagation, rollback auto (intégré Sprint 4 §4.5)
3. **Registry GC** : 3 images/app + :latest + cron quotidien + disk guard 80% (intégré Sprint 3 §3.6)
4. **Passkey recovery** : multi-device obligatoire OU 10 backup codes + CLI admin-recovery via shell root (intégré Sprint 1 §1.5)
