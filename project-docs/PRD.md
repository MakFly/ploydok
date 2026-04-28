# PRD — Ploydok

> PaaS self-hosted giga-lite, security-first, AI-native.
> Alternative minimaliste à Dokploy / Coolify.

---

## 0. Licence

**AGPL-3.0-only** (SPDX: `AGPL-3.0-only`).
- Protège contre fork cloud closed-source
- DCO (Developer Certificate of Origin) obligatoire sur contributions
- Dual-license commerciale laissée ouverte pour futur

## 1. Vision

Offrir à un dev solo ou une petite équipe une plateforme self-hosted mono-VPS pour déployer apps + bases de données en <2 minutes, avec une sécurité de niveau production et un copilote IA qui remplace 80% des tâches d'ops.

**Promesse** : « git push → online en 90 secondes, piloté en langage naturel, sans JAMAIS toucher à Docker. »

---

## 2. Personas

| Persona | Besoin | Pain actuel |
|---|---|---|
| **Dev indie** | Déployer 5-10 side-projects sur 1 VPS | Vercel trop cher, Coolify trop lourd |
| **CTO early-stage** | Staging + prod rapides, sécu OK | K8s overkill, Dokploy = Swarm complexe |
| **Agency dev** | Gérer 20 clients sur VPS partagés | Multi-tenant sécurisé = galère |

---

## 3. Non-goals (v1)

- Pas de multi-cluster / multi-node
- Pas de K8s
- Pas de marketplace 200+ services
- Pas de facturation intégrée
- Pas de build Windows / macOS runners

---

## 4. Stack technique (figée)

### Frontend (monorepo)
```bash
bunx --bun shadcn@latest init --preset bgm023GIT --template start --monorepo
```
- Preset `bgm023GIT` + template `start` + monorepo **obligatoire**
- React + Vite + shadcn/ui + Tailwind
- Tanstack Query + Tanstack Router
- WebAuthn via `@simplewebauthn/browser`

### Backend
- **Runtime** : Bun
- **Framework** : Hono (API + WebSocket)
- **DB** : SQLite + Drizzle ORM (SQLCipher pour chiffrement at-rest)
- **Queue** : BullMQ-lite équivalent maison ou `bun:sqlite` queue

### Agent & infra
- **ploydok-agent** : daemon Rust, seul process à toucher `docker.sock`, expose API gRPC restreinte (allowlist d'actions)
- **Reverse proxy** : Caddy, piloté via admin API `:2019`
- **Build** : BuildKit rootless, user namespaces, seccomp profile strict

### IA
- Hors roadmap v1.0. Le copilote reste un backlog post-v1 et ne fait pas
  partie de l'architecture livrée.

---

## 5. Architecture

```
┌─────────────────────────────────────────────┐
│  Browser (Passkey auth)                     │
└──────────────┬──────────────────────────────┘
               │ HTTPS (Caddy :443)
               ▼
┌─────────────────────────────────────────────┐
│  ploydok-web (React)                        │
└──────────────┬──────────────────────────────┘
               │ REST + WS
               ▼
┌─────────────────────────────────────────────┐
│  ploydok-api (Bun + Hono)                   │
│  - Auth / RBAC / Audit                      │
│  - Monitoring / API tokens / terminal       │
└──────┬──────────────────────────┬───────────┘
       │ gRPC (mTLS, unix socket) │ admin API
       ▼                          ▼
┌──────────────────┐      ┌───────────────┐
│ ploydok-agent    │      │ Caddy         │
│ (Rust, rootless) │      │ (reverse prx) │
└────────┬─────────┘      └───────────────┘
         │ docker.sock
         ▼
┌─────────────────────────────────────────────┐
│ User containers (apps, DBs) — rootless      │
└─────────────────────────────────────────────┘
```

---

## 6. Features par priorité

### P0 — v1.0 (ship or die)
1. Auth passkey + backup codes + multi-device enforcement + session management UI + API tokens scopés
2. Connecter repos Git : **GitHub + GitLab + Gitea**
3. Deploy from Git (Dockerfile ou Nixpacks) + **Deploy from Docker image**
4. **Monorepo subpath** + build command overrides
5. **Build cache persistant**
6. **Zero-downtime deploy (blue-green)** + **custom healthchecks**
7. Domaine custom + TLS auto (HTTP-01, **DNS-01 wildcard**, **import cert manuel**)
7bis. **Protection apps** : Basic Auth / IP allowlist / rate-limit par app
8. Env vars chiffrées **+ scopes (shared/prod/preview/dev)**
9. **Deploy hooks pre/post**
10. **Ressource quotas par app** (CPU/RAM/PIDs) + **network isolation par projet**
11. Databases one-click (Postgres, Redis, Mongo) + backups chiffrés S3/R2 + **rotation password orchestrée zero-downtime**
12. Webhook auto-deploy sur push
13. Logs live WS + **terminal web in-container** (read-only par défaut)
14. Stop / restart / rollback
15. **Monitoring hôte** (disque/RAM/load VPS) + metrics containers
16. Audit log hash-chainé
17. Copilot IA read-only (Q&A, diagnostic, génération config)

### P1 — v1.1 (≤ 2 mois post-release)
18. CLI client (auth par API token)
19. Logs retention + recherche FTS5
20. Static sites optimisés (Caddy file_server direct)
21. Docker Compose multi-services complet
22. **Import depuis Dokploy / Coolify** (migration path)
23. **Secret groups** (partage entre apps)
24. **Logs drains externes** (Datadog / Logtail / Loki)
25. **Export manifest YAML** (DR user-side)
26. **Accessibilité WCAG 2.1 AA** (audit axe-core)
27. **Telemetry opt-in + error tracking** (Glitchtip self-hosted)

### P2 — v1.5 (3-6 mois)
22. Copilot IA write actions (gatées passkey)
23. Preview environments par PR + auto-teardown
24. Cron jobs / workers
25. Équipes + RBAC granulaire
26. Notifs Discord/Slack/email/webhook
27. Multi-VPS (agents distants via Wireguard)

---

## 7. Sécurité — checklist bloquante

- [ ] Passkey / WebAuthn obligatoire, TOTP fallback
- [ ] JWT 10min + refresh rotatif, cookies `httpOnly; Secure; SameSite=Strict`
- [ ] Secrets AES-256-GCM, clé master dans OS keyring
- [ ] Agent Rust = seul à avoir socket Docker, allowlist d'actions
- [ ] Builds rootless + seccomp + no-new-privileges
- [ ] Scan Trivy à chaque build, block si CVE `CRITICAL`
- [ ] CSP strict, HSTS, CSRF tokens
- [ ] Rate-limit IP + user sur endpoints sensibles
- [ ] Audit log append-only hash-chainé (tamper-evident)
- [ ] Backups chiffrés client-side (age)
- [ ] Secrets jamais loggés, jamais envoyés au LLM

---

## 8. Backlog post-v1 — Copilot IA

### Intents envisagés (read-only)
- « Montre les logs erreur de `api` sur 1h »
- « Pourquoi `web` crash ? »
- « Génère un Dockerfile pour une app Next.js »
- « Quelles apps consomment > 80% CPU ? »
- « Diagnostique ce message d'erreur : ... »

### Intents write futurs (confirmation passkey)
- « Deploy `feat-x` sur staging »
- « Rollback `api` à v1.4.2 »
- « Restart `db-prod` »
- « Scale `worker` à 3 instances »

### Garde-fous
- Action destructive → modal passkey challenge
- Tools scopés au projet courant (pas de cross-tenant)
- Prompt caching sur contexte système (réduction coût ~90%)
- Logs conversations chiffrés, rétention 30j

---

## 9. Metrics produit (North Star)

- **Time-to-first-deploy** : < 5 min (inscription → app live)
- **Deploy p95** : < 90s
- **Uptime ploydok-api** : 99.9%
- **% actions via copilot** (v1.5) : > 30%

---

## 10. Roadmap v1.0

> Analyse des gaps vs Dokploy/Coolify/Vercel : voir [gap-analysis.md](./gap-analysis.md). 13 gaps critiques intégrés en v1.0, 4 reportés v1.1.

### Sprint 1 — Fondations (P0)
**Objectif** : squelette monorepo + auth fonctionnelle.
- [ ] Init monorepo via preset obligatoire : `bunx --bun shadcn@latest init --preset bgm023GIT --template start --monorepo`
- [ ] Workspaces : `apps/web`, `apps/api`, `packages/ui`, `packages/db`, `packages/agent-proto`
- [ ] Drizzle schema v1 (users, sessions, projects, apps, secrets, audit_log)
- [ ] Auth passkey (register + login)
- [ ] Layout shell UI (sidebar, topbar, dashboard vide)
- [ ] CI GitHub Actions (lint, typecheck, test)

**Deliverable** : on se log avec passkey, on voit un dashboard vide.

---

### Sprint 2 — Agent Rust + Caddy pilot
**Objectif** : tuyauterie pour parler à Docker et Caddy en sécu.
- [ ] Crate `ploydok-agent` (tonic gRPC + bollard pour Docker)
- [ ] Allowlist d'actions : `container.create/start/stop/rm/logs/stats`, `image.pull/build`, `network.create`
- [ ] mTLS unix socket entre api et agent
- [ ] Module `caddy-client` dans api (admin API wrapper)
- [ ] Tests d'intégration : créer container nginx via agent, l'exposer via Caddy

**Deliverable** : appel API `POST /debug/spawn-nginx` → nginx live sur sous-domaine auto.

---

### Sprint 3 — Deploy from Git
**Objectif** : le cœur du produit, avec zero-downtime dès v1.0.
- [ ] Abstraction `GitProvider` (GitHub 1re implémentation)
- [ ] GitHub OAuth App + connexion repo
- [ ] Clone workspace éphémère, détection Dockerfile / Nixpacks
- [ ] Support monorepo : `root_dir`, overrides build/install/start
- [ ] BuildKit rootless + **cache persistant** (rebuilds 3-5× plus rapides)
- [ ] **Zero-downtime blue-green** via Caddy + **custom healthchecks**
- [ ] UI `app/:id` avec logs live, status, domaine, rollback

**Deliverable** : deploy Next.js en < 2 min, zero 5xx pendant redeploy.

---

### Sprint 3bis — Multi-source deploy & quotas
**Objectif** : élargir les sources et protéger l'hôte.
- [ ] Adapters GitProvider : GitLab, Gitea self-hosted
- [ ] Deploy from Docker image (registries publics + privés)
- [ ] Ressource quotas par app (plans nano/small/medium/large/custom)
- [ ] Enforcement global instance (max apps, max RAM totale)

**Deliverable** : Gitea + GitLab + image Plausible déployés, OOM isolé.

---

### Sprint 4 — Secrets, domaines, DB one-click
**Objectif** : autonomie complète pour une app réelle.
- [ ] Env vars AES-256-GCM **+ scopes (shared/prod/preview/dev)**
- [ ] Domaines custom + vérif DNS + TLS Caddy auto (HTTP-01)
- [ ] **Wildcard TLS via DNS-01** (Cloudflare, Route53, OVH, DO)
- [ ] Templates DB : Postgres / Redis / Mongo
- [ ] Connexion DB → app (env var auto-injectée)
- [ ] **Deploy hooks pre/post** (migrations, seed, warm-up)
- [ ] Webhook auto-deploy sur push (tous providers)
- [ ] Backup schedule chiffré vers S3/R2 (age)

**Deliverable** : app + Postgres + domaine wildcard + migrations auto via hooks.

---

### Sprint 6 — Hardening + release 1.0
**Objectif** : prod-ready.
- [ ] Audit log hash-chainé + UI timeline
- [ ] Rate-limiting (sliding window SQLite)
- [ ] **API tokens scopés** (création/rotation/révocation)
- [ ] **Terminal web in-container** (passkey gate, read-only par défaut, session loggée)
- [ ] **Monitoring hôte VPS** (disque/RAM/load, alertes seuils)
- [ ] Scan Trivy intégré au build, block CVE critique
- [ ] CSP/HSTS/CSRF pass Mozilla Observatory A+
- [ ] Pentest interne (checklist OWASP ASVS L2)
- [ ] Doc utilisateur + script d'install one-liner (3 modes takeover/coexist/abort)
- [ ] Suite tests 7 niveaux + matrice install + backup/DR
- [ ] Release binaire + image Docker officielle

**Deliverable** : `curl install.ploydok.sh | bash` → instance prod-ready.

---

## 11. Structure monorepo cible

```
ploydok/
├── apps/
│   ├── web/          # React + shadcn (preset bgm023GIT)
│   └── api/          # Bun + Hono
├── packages/
│   ├── ui/           # composants shadcn partagés
│   ├── db/           # schema Drizzle + migrations
│   ├── agent-proto/  # proto gRPC partagé TS
│   └── shared/       # types, zod schemas, constantes
├── agent/            # crate Rust ploydok-agent
├── docs/             # PRD, ADRs, runbooks
└── scripts/          # install.sh, seed, backup tools
```

---

## 12. Risques & mitigations

| Risque | Impact | Mitigation |
|---|---|---|
| Agent Rust bug → compromission socket Docker | Critique | Fuzz tests + audit externe avant v1 |
| Copilot exécute action destructive non voulue | Haut | Passkey challenge + v1 read-only only |
| BuildKit rootless instable sur certains kernels | Moyen | Fallback buildx non-rootless documenté |
| GitHub API rate-limit | Moyen | Cache ETag + backoff exponentiel |
| SQLite write contention > 100 apps | Faible | WAL mode + v2 migration Postgres si besoin |

---

## 13. Installation & coexistence (spec : [install-strategy.md](./install-strategy.md))

- Script one-liner avec 3 modes : `takeover` / `coexist` / `abort`
- **Détection nginx / apache2 / caddy / traefik / haproxy existants** avant toute modif
- Mode `coexist` : Ploydok sur `:8080/:8443`, snippet reverse-proxy généré pour l'existant
- Mode `takeover` : arrêt du service concurrent + backup config + rollback possible
- Flags non-interactifs pour IaC (`--yes`, `--unattended`, `--mode=...`)
- Idempotent, uninstall propre avec `--restore-previous-proxy`

## 14. Tests (spec : [testing-strategy.md](./testing-strategy.md))

7 niveaux, bloquants release :
1. Unitaires (bun/cargo, couverture ≥ 80%)
2. Intégration API (Hono + DB réelle)
3. Intégration agent ↔ Docker (allowlist, DinD)
4. E2E Playwright (9 scénarios golden path)
5. Sécurité statique (audit, Trivy, Semgrep) + dynamique (ZAP, IDOR, pentest manuel OWASP ASVS L2)
6. Charge (k6 — p95 API < 300ms, 100 apps concurrentes)
7. Chaos (kill services, disque plein, SQLite corrompue, reboot, coupures externes)

Plus : **suite install matrix** (3 OS × 4 états initiaux) et **backup/DR** (restore complet sur nouveau VPS).

## 15. Definition of Done (chaque sprint)

- Tests unitaires > 70% sur packages critiques (`db`, `agent-proto`, `shared`)
- Tests e2e Playwright sur golden path du sprint
- Typecheck + lint verts
- Doc utilisateur mise à jour
- Changelog incrémenté
- Demo vidéo 2 min pushée dans `docs/demos/`
