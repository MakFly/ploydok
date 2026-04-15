# Sprint 6 — Hardening & Release 1.0

**Durée** : 1 semaine
**Objectif** : passer de MVP fonctionnel à produit prod-ready distribuable.
**Dépendances** : Sprints 1-5 terminés.

---

## Scope

Sécurité validée, installation one-liner, doc utilisateur, observabilité, release publique.

---

## Tâches détaillées

### 6.1 Audit log hash-chainé
- Chaque entrée audit : `{ ts, user_id, action, target, payload_hash, prev_hash, this_hash }`
- `this_hash = sha256(prev_hash || canonical_json(entry))`
- Endpoint `GET /audit/verify` → rejoue toute la chaîne, retourne OK/KO + première rupture
- UI timeline `/settings/audit` avec filtres (user, action, date)
- Export CSV signé

### 6.2 Rate-limiting global
- Sliding window via SQLite (pas de Redis pour rester mono-process)
- Par IP + par user token
- Règles :
  - `/auth/*` : 10/min/IP
  - `/copilot/chat` : 50/h/user
  - `/webhooks/*` : 60/min/IP (GitHub)
  - `/api/*` (mutations) : 300/min/user
- Headers standards : `X-RateLimit-*`, `Retry-After`

### 6.3 Scan vulnérabilités
- Trivy intégré au pipeline build :
  - Scan image post-build
  - Rapport sauvé dans `build_reports`
  - Block deploy si CVE `CRITICAL` détecté (configurable par app : off/warn/block)
- Scan agent Rust : `cargo audit` en CI

### 6.4 Hardening HTTP
- CSP stricte (aucun inline sauf nonce, `default-src 'self'`)
- HSTS `max-age=31536000; includeSubDomains; preload`
- CSRF token double-submit sur mutations
- Permissions-Policy restrictive
- Cible : score A+ sur Mozilla Observatory

### 6.4-bis Suite de tests complète (voir [../testing-strategy.md](../testing-strategy.md))
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

### 6.7 Script d'installation (spec complète : [../install-strategy.md](../install-strategy.md))
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

### 6.7-bis Tests d'installation (suite dédiée)
- VMs Vagrant ou GHA matrix jouant les 8 scénarios de `testing-strategy.md §Test d'installation`
- Assertions : service up, login OK, service concurrent préservé (mode coexist) ou restaurable (mode takeover)
- Bloquant release

### 6.8 Doc utilisateur
- Site docs (VitePress ou Starlight) : `docs.ploydok.dev`
- Sections :
  - Getting started (install, premier deploy)
  - Guide deploy : Next.js, Python, Go, Rails
  - Databases
  - Domains & TLS
  - Copilot IA
  - Sécurité (thread model, best practices)
  - Troubleshooting + runbooks
  - API reference (OpenAPI auto-généré)

### 6.9 Release
- Version `1.0.0` tag git
- Changelog complet (Keep a Changelog format)
- GitHub Release avec binaires agent (Linux x86_64, arm64)
- Images Docker sur GHCR + Docker Hub, signées (cosign)
- Announcement : README principal + Show HN + Twitter/Bluesky

---

## Deliverable démo

1. Fresh VPS Ubuntu 24.04
2. `curl ... | bash`
3. 3 minutes plus tard : passkey enrollment → dashboard
4. Deploy une app test
5. Copilot répond
6. Mozilla Observatory → A+
7. Trivy → 0 CVE critique

---

## Definition of Done

- [ ] Mozilla Observatory : A+
- [ ] Trivy : 0 CVE critique sur toutes images
- [ ] `cargo audit` : 0 vuln
- [ ] Pentest checklist 100% verte (ou risques acceptés + documentés)
- [ ] Install one-liner testé sur Ubuntu 22.04 / 24.04 / Debian 12 **× 4 états (vierge / +nginx / +apache2 / +Docker custom)**
- [ ] 3 modes install (takeover / coexist / abort) vérifiés sur VMs fraîches
- [ ] Uninstall + restore previous proxy : nginx/apache2 redémarrent avec leur config d'origine
- [ ] Suite tests 7 niveaux verte (unit/api/agent/e2e/sécu/perf/chaos)
- [ ] Backup/DR : restore complet testé sur nouveau VPS, apps redéployables
- [ ] Doc publique en ligne, Getting started testé par 3 personnes externes
- [ ] Release v1.0.0 publiée, images signées, changelog complet
- [ ] Metrics Prometheus exposées et documentées
- [ ] API tokens : création/révocation/scope checks e2e green
- [ ] Terminal web : session loggée complètement dans audit log, read-only par défaut
- [ ] Monitoring hôte : dashboard serveur + alertes disque/RAM/load fonctionnels

---

## Risques sprint

| Risque | Mitigation |
|---|---|
| Pentest révèle faille bloquante | Buffer J6-7 pour fix + re-test, sinon delay release |
| CVE critique dans deps peu avant release | Freeze deps J3, rebuild si fix upstream dispo |
| Install script casse sur distro obscure | Support officiel Ubuntu/Debian only v1, reste = best-effort |
| Doc incomplète | Rédigée en parallèle dès Sprint 1, revue finale J6 |

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
