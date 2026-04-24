# Gap Ploydok vs Dokploy — sidebar & système Marketplace

**Date** : 2026-04-24
**Contexte** : suite à l'ajout de la route `/orgs/:slug/marketplace` (v0 read-only, catalogue Dokploy fetché client-side + copy compose). Cet audit liste ce qu'il faut pour atteindre la parité Dokploy côté UI navigation + système d'install de services.

---

## 1. Système « Marketplace » — v0 actuel vs Dokploy

### Ce qui est en place (v0)

- Route `/orgs/:slug/marketplace` (authed, org-scopée).
- Catalogue fetché depuis `https://templates.dokploy.com/meta.json` côté client.
- Dialog détail avec `docker-compose.yml` + copy-to-clipboard + liens GitHub/Docs.
- **Read-only** : aucune install, aucune persistance, aucune interaction avec l'agent Rust.

### Ce que fait Dokploy en plus

| Capacité                                                                                                                    | Effort |
| --------------------------------------------------------------------------------------------------------------------------- | ------ |
| Parser + templatiser le compose (DSL : `$SERVICE_PASSWORD_64_X`, `$SERVICE_FQDN_X`, `$SERVICE_USER_X`, `$SERVICE_BASE64_X`) | M      |
| Service = objet first-class en DB (schema `services` à créer, relations `projects` + `env` + `mounts` + `domains`)          | M      |
| Déploiement via l'agent (spawn containers sur le réseau `ploydok-public`)                                                   | M      |
| Lifecycle : start/stop/restart/logs/exec/volumes UI                                                                         | M      |
| Labels Traefik/Caddy auto (host, port, TLS) + domaine auto-généré (type `*.traefik.me` en dev)                              | S      |
| Gestion des mounts de fichiers (certs, configs injectées au spawn)                                                          | S      |
| Backups S3 attachés au service (dépend de Settings > S3 Destinations, cf. §2)                                               | L      |
| Monitoring CPU/RAM/disk par service (dépend de Monitoring existant)                                                         | S      |

**Total effort install 1-click complète : ~1 sprint (M×4 + S×3 + L×1)**.

---

## 2. Gap sidebar — par priorité

### Tier 1 — core manquant pour parité fonctionnelle

| Item Dokploy                                  | Ploydok                               | Effort | Raison                                                                                                                 |
| --------------------------------------------- | ------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| **Remote Servers** (1 agent par VPS)          | —                                     | L      | Architecture mono-host aujourd'hui. Changement DB + agent registration + selection UI. Bloque le multi-tenant serveur. |
| **Users / RBAC** (invitations + rôles)        | orgs existent, rôles internes absents | M      | Schema `memberships` à enrichir (rôle `owner/admin/member/viewer`), invite flow, middleware auth.                      |
| **Deployments (vue globale)**                 | par-app uniquement                    | S      | Queue cross-project, filtres par statut. Route `/orgs/:slug/deployments`.                                              |
| **Schedules (cron jobs)**                     | —                                     | M      | Schema `schedules`, runner dans `apps/api/src/worker`, UI CRUD.                                                        |
| **Docker (vue host)**                         | —                                     | M      | Liste containers/images/volumes/networks bruts. UI pour debug. Gated admin.                                            |
| **Audit Logs**                                | —                                     | S      | Append-only table + middleware log, UI filtrage.                                                                       |
| **S3 Destinations**                           | —                                     | M      | Schema `backup_destinations`, test connection, attachement backups. Prérequis pour backup off-site.                    |
| **Certificates** (mTLS / custom certs import) | —                                     | S      | Prod-only, utile pour internal routes et intégrations tierces.                                                         |

### Tier 2 — confort / ops

| Item Dokploy                                  | Ploydok                       | Effort                                                                       |
| --------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------- |
| **Traefik File System** (éditeur config live) | —                             | S (on a Caddy admin API déjà branchée, il faut juste une UI read/write JSON) |
| **Requests** (logs requêtes reverse proxy)    | —                             | M (dépend d'un collecteur de logs Caddy)                                     |
| **Swarm / Cluster**                           | —                             | L (seulement si on vise multi-node)                                          |
| **SSH Keys**                                  | —                             | S (si on ajoute Remote Servers)                                              |
| **Tags**                                      | —                             | XS (metadata libre sur apps/services)                                        |
| **AI config**                                 | AI Copilot (stub coming soon) | — (déjà planifié)                                                            |

### Tier 3 — monétisation / SaaS (v1.5+)

| Item Dokploy    | Ploydok | Note                                   |
| --------------- | ------- | -------------------------------------- |
| Billing         | —       | Stripe intégration, hors-scope core    |
| License         | —       | Self-hosted licensing, non prioritaire |
| SSO (SAML/OIDC) | —       | Enterprise feature                     |
| Whitelabeling   | —       | Branding custom, enterprise feature    |

---

## 3. Ce qui est déjà à parité

- Dashboard = Home
- Applications = Projects (nommage différent mais scope équivalent)
- Databases (managed, Ploydok est même plus propre car ≠ bricolé via compose)
- Monitoring
- Settings > Profile / Git providers / Registry / Notifications / Security

---

## 4. Recommandation de sprint « parité Dokploy »

Ordre suggéré pour un sprint focalisé :

1. **Services first-class** (schema + install 1-click marketplace) — débloque la valeur user immédiate posée par la route v0.
2. **RBAC complet** — nécessaire avant tout multi-utilisateur sérieux.
3. **Remote Servers** — ouvre le multi-host (gros différenciateur vs Coolify aussi).
4. **Deployments global + Schedules** — quality-of-life ops.
5. **Audit Logs + S3 Destinations** — prérequis compliance/backup.

**Hors-scope explicite v1** : Swarm, Billing, License, SSO, Whitelabeling. Rester sur le PRD v1 tant que ces items ne sont pas demandés user-side.

---

## 5. Risques

- **Divergence compose-DSL** : Dokploy utilise `$SERVICE_PASSWORD_64_X` — si on copie leur DSL, on hérite de leur format. Mieux : adopter le DSL tel quel (compat directe avec leurs 100+ templates) plutôt qu'inventer.
- **Réseau `ploydok-public`** : tout service installé via marketplace doit y être joint, sinon Caddy ne pourra pas router. À prévoir côté agent.
- **Secrets générés** : ne jamais les logger, les stocker chiffrés comme les env vars apps (cf. `packages/db/src/queries/secrets.ts`).
