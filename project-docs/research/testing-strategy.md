# Stratégie de tests — Ploydok

> Une seule règle : rien ne part en v1.0 sans passer les 7 niveaux de tests ci-dessous.

---

## Niveau 1 — Unitaires

- **Cible** : fonctions pures, schémas zod, crypto helpers, agent Rust logic
- **Outils** : `bun test`, `cargo test`
- **Couverture cible** : ≥ 80% sur `packages/{db,shared,agent-proto}` et crate `agent`
- **Fréquence** : à chaque push, bloquant merge

---

## Niveau 2 — Intégration API

- **Cible** : chaque endpoint Hono avec DB réelle + agent mocké
- **Outils** : `bun test` + SQLite in-memory + harness agent fake
- **Scénarios** : CRUD apps/secrets/domains, auth flows, rate-limit
- **Fréquence** : CI, bloquant

---

## Niveau 3 — Intégration agent ↔ Docker

- **Cible** : crate Rust parlant à un vrai Docker daemon
- **Outils** : `cargo test` + Docker-in-Docker ou runner self-hosted
- **Scénarios** : allowlist (10 actions OK / 20 actions refusées), logs stream, cleanup
- **Fréquence** : CI nightly + pre-release

---

## Niveau 4 — E2E Playwright

- **Cible** : flux utilisateur complets depuis browser
- **Outils** : `@playwright/test`, headless Chromium + Firefox
- **Scénarios golden path** :
  1. Enrollment passkey initial + login
  2. Connect GitHub → deploy Next.js → URL live
  3. Ajout env var + redeploy → valeur présente dans app
  4. Ajout domaine custom + TLS
  5. Créer Postgres → link app → connection OK
  6. Webhook push → auto-deploy
  7. Rollback app à N-1
  8. Backup DB → restore → data présente
- **Fréquence** : CI sur `main`, bloquant release

---

## Niveau 5 — Sécurité

### 5.1 Statique
- `bun audit`, `cargo audit` : 0 CVE haute/critique tolérée
- Semgrep rules custom (secrets patterns, SQL raw, `eval`)
- Trivy sur images finales

### 5.2 Dynamique
- OWASP ZAP baseline sur instance de staging
- Tests IDOR scriptés : user A ne peut pas accéder ressources user B (20 endpoints sensibles)
- Fuzzing des endpoints critiques (`/auth/*`, `/webhooks/*`) via `restler` ou équivalent
- Burp Suite pro : session manuelle pentest avant release

### 5.3 Checklist ASVS L2
Exécutée Sprint 6, documentée dans `docs/security/pentest-v1.md`.

---

## Niveau 6 — Performance & charge

- **Outil** : k6 scripts dans `tests/load/`
- **Scénarios** :
  - 100 apps créées en parallèle → API reste < 500ms p95
  - 1000 deploys séquentiels sur 24h → pas de leak mémoire api/agent
  - 50 WS logs stream simultanés → pas de drop
- **Budget** :
  - API p95 < 300ms (hors build)
  - Agent RPC p95 < 50ms
  - Caddy config reload < 1s
- **Fréquence** : pre-release + trimestriel

---

## Niveau 7 — Chaos & résilience

Scénarios à jouer sur staging, checklist pre-release :

- [ ] `docker kill ploydok-agent` → api détecte, retry, récupère
- [ ] `docker kill ploydok-caddy` → restart auto, routes rechargées
- [ ] SQLite corrompue → restore backup auto → service reprend
- [ ] Disque plein à 95% → alerte + refus nouveaux builds, apps existantes continuent
- [ ] Master key perdue → message clair : restore depuis `age` backup obligatoire
- [ ] Coupure réseau vers GitHub → builds en cours échouent proprement, webhook retry
- [ ] Reboot VPS → tout remonte < 60s
- [ ] Upgrade v1.0 → v1.1 → DB migrée, aucune app user cassée

---

## Test d'installation dédié

Suite `tests/install/` exécutée sur matrice VMs fraîches :

| VM | Scénario install | Assert |
|---|---|---|
| Ubuntu 24.04 vierge | `curl ... \| bash --yes` | instance live + login OK |
| Ubuntu 24.04 + nginx actif | `... --mode=takeover --yes` | nginx stoppé, Caddy sur :443 |
| Ubuntu 24.04 + nginx actif | `... --mode=coexist --yes` | Caddy sur :8080, snippet nginx généré |
| Ubuntu 24.04 + apache2 actif | `... --mode=coexist --yes` | idem avec apache |
| Debian 12 + Docker custom | `... --skip-docker-install --yes` | Docker préservé |
| Ré-install (idempotence) | Relancer même commande | No-op, pas de duplication |
| Downgrade test | install v1.1 puis rollback v1.0 | DB restaurée, apps OK |
| Uninstall + restore | `uninstall --restore-previous-proxy` | nginx redémarre avec sa config d'origine |

Provisionnées via Vagrant ou GitHub Actions matrix, exécutées pre-release + weekly.

---

## Test de backup / DR (critique)

- **Backup DB Ploydok interne** : restauré mensuellement sur instance de test → doit booter et afficher état cohérent
- **Backup DB user (Postgres)** : dump chiffré `age` → restore sur DB vierge → checksum data identique
- **Perte totale VPS** : playbook documenté, testé 1×/trimestre
  - Nouveau VPS + install + restore backup → apps redéployables à partir du manifest stocké

---

## Résumé matriciel

| Niveau | Qui écrit | Fréquence | Bloquant merge | Bloquant release |
|---|---|---|---|---|
| 1 Unitaires | Dev de la feature | Push | ✅ | ✅ |
| 2 API | Dev + QA | Push | ✅ | ✅ |
| 3 Agent/Docker | Dev agent | Nightly | ⚠ | ✅ |
| 4 E2E | QA + Dev | Push `main` | ✅ | ✅ |
| 5 Sécu statique | CI auto | Push | ✅ | ✅ |
| 5 Sécu dynamique | Sécu lead | Pre-release | ❌ | ✅ |
| 6 Performance | QA | Pre-release | ❌ | ✅ |
| 7 Chaos | QA | Pre-release | ❌ | ✅ |
| Install matrix | Release eng | Pre-release + weekly | ❌ | ✅ |
| Backup/DR | Release eng | Mensuel + trimestriel | ❌ | ✅ |
