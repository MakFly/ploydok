# Ploydok — Audit Conformité vs Dokploy / Coolify

**Date :** 2026-04-22 — 00h17
**Auditor :** agent DevOps Senior
**Scope :** état actuel du repo `ploydok` vs références marché self-hosted PaaS (Dokploy + Coolify)

---

## 📊 Matrice comparative par catégorie

| Catégorie | Dokploy | Coolify | Ploydok aujourd'hui | Score /10 |
|---|---|---|---|---|
| **Sources Git** | GH/GL/Bitbucket/Gitea | GH/GL/Bitbucket/Gitea | GH ✅ · GL ✅ code/standby · Image ✅ · Bitbucket ❌ · Gitea ❌ retiré | 6/10 |
| **Auto-deploy webhook** | ✅ complet | ✅ complet | Infra en place, Sprint 3.1.1 non terminé (coalescing, deliveries UI, notifs = ⏳) | 5/10 |
| **Build pipeline** | Dockerfile/Nixpacks/Buildpacks | Dockerfile/Nixpacks/Buildpacks/Static | Dockerfile ✅ · Nixpacks ✅ auto-detect · BuildKit cache ✅ · Buildpacks ❌ | 7/10 |
| **Zero-downtime deploy** | Blue-green ✅ | Blue-green ✅ | Blue-green via Caddy ✅ · healthcheck ✅ · rollback UI ✅ | 9/10 |
| **Quotas & isolation** | Basique | Destinations UI opt-in | Plans nano→large ✅ · cgroups enforcés ✅ · **réseau zero-trust par projet** ✅ dépasse les deux | 9/10 |
| **Secrets / Env vars** | Env vars chiffrées | Env vars + shared groups | Chiffrées AES-GCM ✅ · Scopes shared/prod/preview/dev ✅ schema présent · UI partiellement câblée | 7/10 |
| **Domaines & TLS** | Auto HTTPS ✅ | Auto HTTPS + wildcard ✅ | HTTP-01 via Caddy ✅ · DNS-01 wildcard ❌ (Sprint 4) · Import cert manuel ❌ | 5/10 |
| **Services stateful (one-click DB)** | Postgres/MySQL/Redis/Mongo ✅ | Postgres/MySQL/Redis/Mongo/MariaDB ✅ | ❌ non implémenté (Sprint 4 prévu) | 1/10 |
| **Monitoring** | CPU/RAM/disk basic | Graphs + alerting ✅ | Containers stats SSE ✅ · host disk/RAM ⏳ Sprint 6 · alerting ❌ | 4/10 |
| **Logs** | Live + search basic | Live + search + drains ✅ | Live WS ✅ · historique builds ✅ · FTS search ❌ (v1.1) · drains ❌ | 5/10 |
| **Terminal shell** | ✅ via docker exec | ✅ | WS exec implémenté ✅ (gRPC ContainerExec · pty · auth cookie) | 8/10 |
| **Notifications** | Discord/Email/Telegram ✅ | Discord/Slack/Email/Pushover ✅ | ❌ non implémenté (Sprint 3.1.1 prévu) | 1/10 |
| **Rollback** | ✅ | ✅ | UI deployments history ✅ · bouton rollback ✅ | 8/10 |
| **Templates one-click** | +100 services | +200 services marketplace | ❌ aucun template (PRD non-goal v1) | 0/10 |
| **Multi-node / Swarm** | Swarm ✅ | Multi-server Wireguard ✅ | ❌ mono-VPS délibéré (non-goal v1.0, v1.5 prévu) | 0/10 |
| **Auth & sécurité** | Login/password | Login/password + 2FA | **Passkeys WebAuthn ✅ · TOTP 2FA ✅ · backup codes ✅ · sessions UI ✅** | 10/10 |
| **Backups DB** | S3/local ✅ | S3/R2/local ✅ | ❌ non implémenté (Sprint 4 prévu) | 0/10 |
| **API tokens** | ✅ | ✅ | ❌ non implémenté (Sprint 6 prévu) | 0/10 |
| **Teams / RBAC** | Teams ✅ | Teams ✅ | ❌ single-user uniquement (v1.5) | 0/10 |
| **Collaboration / multi-tenant** | Basique | ✅ | ❌ (v1.5) | 0/10 |
| **PR Preview envs** | ❌ | ✅ | ❌ retiré de 3.1.1, planifié Sprint 3.1.2 | 0/10 |
| **CI/CD (commit status)** | ✅ | ✅ | ⏳ Sprint 3.1.1 (code partiel présent en DB schema) | 3/10 |
| **Volumes persistants** | ✅ | ✅ | ❌ aucune gestion volumes nommés | 0/10 |
| **Install one-liner** | ✅ | ✅ | ❌ script non existant (Sprint 6) | 0/10 |

---

## 🚨 Top 5 — Gaps critiques (ce qui bloque le label "Dokploy-killer")

### 1. 🗄️ Databases one-click (Sprint 4 — impact maximal)
Coolify et Dokploy permettent en 2 clics de spawner un Postgres/Redis/Mongo avec auto-provisioning des `DATABASE_URL` dans l'app liée. C'est **le** use-case n°1 des self-hosters. Ploydok n'a rien : pas de template, pas de connexion DB→app, pas de backup schedule. Bloquant pour 80 % des vraies apps.

### 2. 🔔 Notifications absentes (Sprint 3.1.1 non terminé)
Aucun Discord/Slack/email. Chaque build se passe en silence. Pour un dev qui fait `git push` et veut être notifié sur son téléphone, c'est un no-go opérationnel complet. Dokploy et Coolify ont ça depuis leur v0.x.

### 3. 🌐 TLS wildcard / DNS-01 absent (Sprint 4)
Sans DNS-01, impossible de servir `*.monapp.com` pour les PR previews ou les tenants multi-sous-domaines. L'HTTP-01 seul bloque aussi certains cas LAN/intranet. Coolify supporte Cloudflare/Route53/OVH/DO. Dokploy pareil.

### 4. 🔑 API tokens absents (Sprint 6)
Zéro intégration CI/CD externe possible : pas de `curl -H "Authorization: Bearer xxx"` depuis GitHub Actions ou GitLab CI pour trigger un deploy programmatique. Bloquant pour les workflows automation.

### 5. 💾 Volumes persistants non gérés
Docker volumes nommés = storage persistant pour bases, uploads, assets. Ploydok ne les provisionne pas, ne les liste pas, ne les backup pas. Un restart container = data perdue si l'app n'a pas son propre S3.

---

## ✨ Top 3 — Différenciateurs actuels (ce que Ploydok fait mieux)

### 1. 🔐 Auth passkeys WebAuthn — classe à part
Coolify et Dokploy utilisent login/password + TOTP optionnel. Ploydok impose les **passkeys WebAuthn** comme seule méthode primaire, avec TOTP pour les actions sensibles, sessions management UI, backup codes + CLI `admin-recovery` Rust en dernier recours. C'est de la sécurité 2025, pas 2015. Un seul identifiant piraté ne compromet rien.

### 2. 🦀 Agent Rust isolé — modèle de sécurité supérieur
L'architecture où un daemon Rust (`ploydok-agent`) est le **seul** process avec accès à `docker.sock`, via gRPC sur unix socket avec allowlist stricte, est architecturalement plus sûr que Coolify (Node.js direct sur Docker API) et Dokploy (pas d'isolation équivalente). Exploit de l'API → l'attaquant ne touche pas Docker.

### 3. 🛡️ Isolation réseau zero-trust par projet
Ploydok est **le seul** des trois à enforcer que les apps de projets différents ne partagent aucun réseau Docker par défaut. Dokploy n'a pas d'isolation réseau. Coolify a une isolation opt-in via "Destinations" (désactivée par défaut). Ploydok l'a validé par pentest automatisé e2e. Différenciant fort pour les agences qui hébergent plusieurs clients sur un même VPS.

---

## 📈 Verdict global

**Conformité MVP PaaS self-hosted : ~42 %**

> Score calculé sur les 24 catégories : 14 features implémentées ou partielles sur ~33 attendues pour parité Dokploy/Coolify.

### Ce qu'il reste pour v1.0 publique (4 sprints restants, ~6 semaines)

| Sprint | Livrables clés manquants |
|---|---|
| 3.1.1 (1 sem) | Auto-deploy complet · Notifications · Deliveries UI · Commit status · Coalescing |
| 4 (1 sem) | DB one-click (Postgres/Redis/Mongo) · Backups S3 · Wildcard TLS DNS-01 · Deploy hooks · Env scopes UI |
| 5 (1 sem) | Copilot IA (différenciant, non bloquant parité) |
| 6 (1 sem) | API tokens · Monitoring hôte · Install one-liner · Scan Trivy |

Les **4 sprints restants** sont nécessaires pour atteindre ~75-80 % de parité fonctionnelle. Les 20-25 % restants (multi-node, templates marketplace, PR previews, Buildpacks, teams RBAC) sont délibérément hors scope v1.0 ou planifiés v1.5.

---

## 🎯 TL;DR

Ploydok a un **moteur solide** (build, blue-green, agent Rust, auth) mais manque encore du "confort opérationnel" quotidien (DBs one-click, notifs, volumes, API tokens). La roadmap est cohérente et atteignable. Le positionnement sécurité (**passkeys + zero-trust network**) est un vrai différenciant marché.

---

## 🔜 Prochaine session — pistes à reprendre

- [x] Démarrer (ou terminer) le **Sprint 3.1.1** en priorité : notifications Discord/Slack/Email + Deliveries UI + commit status — livré ✅ (commit `eee35db` — 2026-04-22).
- [x] Préparer le **Sprint 4** : choisir la stack DB one-click (templates Docker vs opérateur custom), benchmark Coolify/Dokploy sur la provisioning DB→app (ENV auto-injectés, backup schedule) — livré ✅ (commits c0c838d / 5131d6330 / 185fb9f / cff0991 — 2026-04-22).
- [x] Décider du positionnement **volumes persistants** : inclure dans Sprint 4 — livré ✅ (volumes nommés `ploydok-db-<id>` dans spawner.ts — W3).
- [x] Valider la stratégie **TLS wildcard DNS-01** : livré ✅ — 4 providers (Cloudflare / Route53 / OVH / DigitalOcean) via modules Caddy xcaddy — W2+W4.
- [x] Archiver ce rapport dans `project-docs/audits/` — fait (ce fichier).

**Mise à jour verdict conformité post-Sprint 4 : ~65 %** (vs 42 % baseline au moment de cet audit).

Les gaps fermés par Sprint 4 : DB one-click + backups S3/R2, wildcard DNS-01 + cert manuel, protection Caddy 3 middlewares, deploy hooks, rotation DB orchestrée zero-downtime, env vars scopes 4 niveaux.
