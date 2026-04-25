# Sprint 6 — Hardening & Release 1.0

**Durée** : 1 semaine
**Objectif** : passer de MVP fonctionnel à produit prod-ready distribuable.
**Dépendances** : Sprints 1-4 terminés (Sprint 5 ⏸️ standby).

> **Scope réduit (décision 2026-04-25)** : seuls **6.5-\*** (pentest, API tokens, terminal web), **6.6** (observabilité + monitoring hôte) et **6.8** (doc user) sont retenus. Tout le reste (6.1 audit hash-chainé, 6.2 rate-limit, 6.3 Trivy, 6.4 hardening HTTP, 6.4-bis suite tests 7 niveaux, 6.7 install one-liner, 6.7-bis tests install, 6.9 release v1.0) est repoussé / hors scope sprint courant.
> La doc user est bootstrappée sous **Astro + shadcn** :
>
> ```bash
> bunx --bun shadcn@latest init --preset b1VlJFnm --template astro --pointer
> ```
>
> Cible : `apps/docs/` (nouveau workspace).

---

## Scope

API tokens scopés + terminal web in-container + observabilité (metrics + monitoring hôte VPS) + documentation utilisateur publique sous Astro/shadcn.

---

## Tâches détaillées

### 6.1 Audit log hash-chainé ⏸️ Hors scope (repoussé post-v1.0)

- Chaque entrée audit : `{ ts, user_id, action, target, payload_hash, prev_hash, this_hash }`
- `this_hash = sha256(prev_hash || canonical_json(entry))`
- Endpoint `GET /audit/verify` → rejoue toute la chaîne, retourne OK/KO + première rupture
- UI timeline `/settings/audit` avec filtres (user, action, date)
- Export CSV signé

### 6.2 Rate-limiting global ⏸️ Hors scope (repoussé post-v1.0)

- Sliding window via SQLite (pas de Redis pour rester mono-process)
- Par IP + par user token
- Règles :
  - `/auth/*` : 10/min/IP
  - `/copilot/chat` : 50/h/user
  - `/webhooks/*` : 60/min/IP (GitHub)
  - `/api/*` (mutations) : 300/min/user
- Headers standards : `X-RateLimit-*`, `Retry-After`

### 6.3 Scan vulnérabilités ⏸️ Hors scope (repoussé post-v1.0)

- Trivy intégré au pipeline build :
  - Scan image post-build
  - Rapport sauvé dans `build_reports`
  - Block deploy si CVE `CRITICAL` détecté (configurable par app : off/warn/block)
- Scan agent Rust : `cargo audit` en CI

### 6.4 Hardening HTTP ⏸️ Hors scope (repoussé post-v1.0)

- CSP stricte (aucun inline sauf nonce, `default-src 'self'`)
- HSTS `max-age=31536000; includeSubDomains; preload`
- CSRF token double-submit sur mutations
- Permissions-Policy restrictive
- Cible : score A+ sur Mozilla Observatory

### 6.4-bis Suite de tests complète ⏸️ Hors scope (repoussé post-v1.0) — voir [../testing-strategy.md](../testing-strategy.md)

Pre-release, exécuter et documenter :

- Niveau 1-2 Unitaires + intégration API : couverture ≥ 80% sur packages critiques
- Niveau 3 Agent/Docker : tests allowlist (10 OK / 20 refusés), logs stream, cleanup
- Niveau 4 E2E Playwright : 9 scénarios golden path (enrollment → deploy → rollback → copilot → backup/restore)
- Niveau 5 Sécu dynamique : OWASP ZAP baseline, IDOR scripts, pentest manuel
- Niveau 6 Charge : k6 — 100 apps concurrentes, 1000 deploys/24h, p95 API < 300ms
- Niveau 7 Chaos : kill agent/caddy, disque plein, SQLite corrompue, reboot, coupure GitHub/Anthropic
- Backup/DR : restore DB Ploydok + restore DB user (Postgres) + perte totale VPS → redéploiement depuis manifest

### 6.5 Pentest interne (OWASP ASVS L2)

Checklist minimale :

- [ ] Auth : brute force, timing attacks, session fixation
- [ ] Authz : IDOR sur `/apps/:id`, `/secrets/:id`, cross-tenant
- [ ] Injection : SQL (Drizzle param-only OK), commande dans git clone (repo name sanitize)
- [ ] Cryptographie : nonces uniques AES-GCM, clés dérivées via HKDF
- [ ] SSRF : validation URLs webhooks
- [ ] Deserialization : zod sur toutes entrées, pas de `eval`
- [ ] File upload : limites taille, types, scan malware (ClamAV optionnel)

Rapport → `docs/security/pentest-v1.md` + fixes avant release.

### 6.5-bis API tokens scopés

- Table `api_tokens` : `user_id`, `name`, `hash` (bcrypt), `scopes[]`, `expires_at`, `last_used_at`
- Scopes granulaires : `apps:read`, `apps:deploy`, `apps:write`, `secrets:read`, `secrets:write`, `databases:*`, `admin:*`
- Création : token plain affiché **une seule fois** (pattern `plk_live_...`)
- Rotation + révocation immédiate
- Middleware Hono : header `Authorization: Bearer plk_...` accepté comme alternative à session cookie
- Audit log : chaque appel track le token utilisé

### 6.5-ter Terminal web in-container

- WS `/apps/:id/exec` piloté par l'agent (`docker exec -it` wrappé)
- Challenge passkey requis avant ouverture de session
- Shell par défaut : `/bin/sh` (fallback si pas bash)
- UI : xterm.js dans onglet `Terminal` de l'app
- **Mode read-only par défaut** (toggle « Enable write » avec second challenge passkey pour prod)
- Session loggée intégralement dans audit log (chaque commande + output), chiffré, rétention 30j
- Timeout auto 15 min idle

### 6.6 Observabilité & monitoring hôte

- Logs structurés JSON (pino ou équiv Bun)
- Metrics Prometheus-compatible sur `/metrics` (auth admin)
- Traces OpenTelemetry optionnelles (env var `OTEL_EXPORTER_OTLP_ENDPOINT`)
- Healthcheck `/health` (DB, agent, Caddy)
- Status page publique minimaliste `/status`
- **Monitoring hôte VPS** (pas juste containers) :
  - Widget dashboard « Server health » : CPU / RAM / disque / load avg / inode usage
  - Agent expose RPC `HostStats()` (lecture `/proc`, `/sys`)
  - Alertes configurables par seuil : disque > 85%, RAM > 90%, load > N CPU
  - Copilot informé de l'état hôte dans son contexte

### 6.7 Script d'installation ⏸️ Hors scope (repoussé post-v1.0) — spec : [../install-strategy.md](../install-strategy.md)

- `curl -fsSL https://install.ploydok.dev | bash`
- Pré-flight check : kernel, user namespaces, Docker, ports, RAM, disque, firewall, **services concurrents (nginx/apache2/caddy/traefik/haproxy)**
- **Gestion conflit ports 80/443** — 3 modes :
  - `--mode=takeover` : arrêt + disable du service existant, backup config dans `/var/backups/ploydok-install/`
  - `--mode=coexist` : Ploydok sur `:8080/:8443`, génération snippet reverse-proxy pour nginx/apache2
  - `--mode=abort` : zéro modif, rapport preflight retourné
- Flags non-interactifs : `--yes`, `--unattended`, `--http-port`, `--https-port`, `--skip-docker-install`, `--manage-firewall`
- Idempotent (ré-exécution = no-op ou upgrade)
- Uninstall : `ploydok-cli uninstall [--restore-previous-proxy]`
- Matrice compat testée : Ubuntu 22.04/24.04, Debian 12 × (vierge / +nginx / +apache2 / +Docker custom)

### 6.7-bis Tests d'installation ⏸️ Hors scope (repoussé post-v1.0)

- VMs Vagrant ou GHA matrix jouant les 8 scénarios de `testing-strategy.md §Test d'installation`
- Assertions : service up, login OK, service concurrent préservé (mode coexist) ou restaurable (mode takeover)
- Bloquant release

### 6.8 Doc utilisateur (Astro + shadcn)

- Stack : **Astro + shadcn** (preset `b1VlJFnm`), déployé sur `docs.ploydok.dev`.
- Bootstrap dans nouveau workspace `apps/docs/` :
  ```bash
  bunx --bun shadcn@latest init --preset b1VlJFnm --template astro --pointer
  ```
- Ajouter `apps/docs` au workspace Bun + Turbo (`turbo.json`, `package.json` racine).
- Sections :
  - Getting started (install, premier deploy)
  - Guide deploy : Next.js, Python, Go, Rails
  - Databases
  - Domains & TLS
  - Sécurité (threat model, best practices)
  - Troubleshooting + runbooks
  - API reference (OpenAPI auto-généré depuis Hono)
- Pas de section Copilot (Sprint 5 standby).

### 6.9 Release ⏸️ Hors scope (repoussé post-v1.0)

- Version `1.0.0` tag git
- Changelog complet (Keep a Changelog format)
- GitHub Release avec binaires agent (Linux x86_64, arm64)
- Images Docker sur GHCR + Docker Hub, signées (cosign)
- Announcement : README principal + Show HN + Twitter/Bluesky

---

## Deliverable démo

1. Pentest checklist OWASP ASVS L2 verte (rapport `docs/security/pentest-v1.md`)
2. Création d'un API token scopé `apps:deploy` → `curl -H "Authorization: Bearer plk_live_..."` triggers un deploy
3. Ouverture terminal web dans une app live (challenge passkey + session loggée audit)
4. Dashboard « Server health » affiche CPU/RAM/disque/load du VPS, alerte disque > 85% configurable
5. `curl /metrics` (auth admin) → exposition Prometheus
6. Site `docs.ploydok.dev` (Astro + shadcn) en ligne avec Getting started + API reference

---

## Definition of Done

- [ ] Pentest checklist OWASP ASVS L2 100% verte (ou risques acceptés + documentés dans `docs/security/pentest-v1.md`) — _checklist initiale créée 2026-04-25_
- [x] **API tokens — colonne `scopes[]` + middleware Bearer (legacy `ploy_` + nouveau `plk_live_`) + audit log par appel + helper `tokenHasScope` + middleware `requireScope`**
- [x] **API tokens — bcrypt dual-hash non-destructif** (colonne `bcrypt_hash` nullable, lookup SHA-256 indexé + verify bcrypt si présent ; legacy `ploy_*` continuent à marcher)
- [x] **API tokens — nouveaux tokens créés au format `plk_live_<base64url>` (pattern documenté DoD)**
- [x] **API tokens UI : sélecteur de scopes (chips multi-select), affichage `plk_live_...` une seule fois + bouton Copy, affichage scopes par token dans la liste, bug double-stringify fixé dans lib/api-tokens.ts**
- [x] **Terminal web : read-only par défaut + toggle « Enable write » avec confirm dialog, query `?mode=ro|rw` côté WS, drop stdin server-side si mode=ro, indicateur visuel mode dans la barre du terminal, audit log table `audit_log` action `app.exec.start` (queryable via /audit) avec metadata mode/cols/rows**
- [ ] Terminal web : challenge passkey à l'ouverture + second challenge passkey pour activer mode rw (WebAuthn integration)
- [ ] Terminal web : chiffrement audit log session (commande+output), cron rétention 30j
- [x] **Metrics Prometheus exposées sur `/metrics` (gated `PLOYDOK_METRICS_TOKEN`)**
- [x] **Healthcheck split : `/health` liveness (toujours 200) + `/health/ready` readiness deep (DB+agent+Caddy)**
- [x] **`/status` page publique JSON**
- [x] **Widget `SystemHealthCard` côté web** — consomme `/health/ready`, affiché en tête de `/orgs/$orgSlug/monitoring`, refetch 30s
- [x] **Monitoring hôte VPS — RPC `HostStats()` côté agent Rust** : module `host_stats.rs` lit /proc/stat (CPU delta 100ms), /proc/meminfo, /proc/loadavg, /proc/uptime, /proc/cpuinfo + libc::statvfs("/") pour disk/inodes
- [x] **API `/host-stats`** : wrapper gRPC + calcul alertes (disk > 85%, mem > 90%, load > 1.5/cpu) + thresholds configurables
- [x] **UI `HostHealthCard`** : CPU/Memory/Disk/Load avg avec couleurs seuil, badge alertes, uptime — affiché dans page Monitoring
- [x] **Site doc Astro + shadcn dans `apps/docs/` (12 pages, build vert, intégré workspace)**
- [ ] Site doc déployé sur `docs.ploydok.dev`, Getting started testé par 3 personnes externes
- [ ] API reference OpenAPI auto-générée depuis Hono publiée dans la doc

---

## Risques sprint

| Risque                                   | Mitigation                                                  |
| ---------------------------------------- | ----------------------------------------------------------- |
| Pentest révèle faille bloquante          | Buffer J6-7 pour fix + re-test, sinon delay release         |
| CVE critique dans deps peu avant release | Freeze deps J3, rebuild si fix upstream dispo               |
| Install script casse sur distro obscure  | Support officiel Ubuntu/Debian only v1, reste = best-effort |
| Doc incomplète                           | Rédigée en parallèle dès Sprint 1, revue finale J6          |

---

## Post-release (backlog)

### v1.1 (≤ 2 mois)

- CLI client `ploydok-cli` (Bun compilé, auth par API token)
- Logs retention + recherche FTS5 (7j default, export S3)
- Static sites optimisés (type `static`, Caddy file_server direct)
- Docker Compose multi-services complet (parser + mapping apps + dépendances)

### v1.5 (3-6 mois)

- Copilot write actions (deploy/rollback/restart, gatées par passkey)
- Preview envs par PR (auto-teardown à fermeture)
- Équipes + RBAC granulaire
- Cron jobs / workers (type app dédié)
- Notifications externes (Discord/Slack/email/webhook) avec matrice events
- Multi-VPS via Wireguard (agents distants fédérés)
