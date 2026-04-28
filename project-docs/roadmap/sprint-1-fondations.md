# Sprint 1 — Fondations ✅ Terminé

> **Statut : TERMINÉ** — audit 2026-04-20.
> Gap multi-device (`requireSecondFactor`) clos : middleware monté sur les routes mutantes
> (`apps/api/src/routes/apps.ts:231`, `apps-env.ts:79`, `apps-domains.ts:165`) + check TOTP
> (fix 2026-04-20 `auth.ts:94-111`).

**Durée** : 1 semaine
**Objectif** : squelette monorepo opérationnel + auth passkey fonctionnelle.
**Dépendances** : aucune (sprint kickoff).

---

## Scope

Mettre en place toute la tuyauterie de dev pour que les sprints suivants puissent avancer sans friction : monorepo, DB, auth, CI, layout UI.

---

## Pré-requis

- Bun ≥ 1.1
- Node 20 (pour certains outils dev uniquement)
- Docker (pour tests intégration ultérieurs)
- Compte GitHub + repo `ploydok` créé

---

## Tâches détaillées

### 1.1 Initialisation monorepo (obligatoire)
```bash
bunx --bun shadcn@latest init --preset bgm023GIT --template start --monorepo
```
- Vérifier que `components.json` est bien généré
- Confirmer workspaces Bun dans `package.json` racine

### 1.2 Structure workspaces
Créer/ajuster :
- `apps/web/` — front React (issu du template)
- `apps/api/` — Bun + Hono (nouveau)
- `packages/ui/` — composants shadcn partagés (issu du preset)
- `packages/db/` — schema Drizzle + migrations
- `packages/shared/` — types, zod schemas, constantes
- `packages/agent-proto/` — stubs TS (rempli sprint 2)

### 1.3 Base de données
- Installer `drizzle-orm` + `drizzle-kit` + `@libsql/client` ou `bun:sqlite`
- Schema v1 : `users`, `sessions`, `passkeys`, `projects`, `apps`, `secrets`, `audit_log`
- Migration initiale + script `bun db:migrate`
- Seed de dev : 1 user, 1 project

### 1.4 API skeleton
- Hono app avec middlewares : logger, CORS strict, CSRF, error handler
- Routes stubs : `/health`, `/auth/*`, `/me`
- Config via `env.ts` validé par zod
- Secrets master key chargée depuis OS keyring (lib `keytar` ou équiv) avec fallback `.env` pour dev

### 1.5 Auth passkey (WebAuthn) + recovery
- Serveur : `@simplewebauthn/server`
- Client : `@simplewebauthn/browser`
- Flux : register → login challenge → session JWT 10min + refresh 7j rotatif
- Cookies `httpOnly; Secure; SameSite=Strict`
- Endpoints : `/auth/register/options`, `/auth/register/verify`, `/auth/login/options`, `/auth/login/verify`, `/auth/logout`, `/auth/refresh`
- **Multi-device obligatoire** : après 1er login, UI bloque actions critiques tant que l'user n'a pas :
  - 2 passkeys enrollées (2 devices distincts) **OU**
  - 1 passkey + 10 backup codes générés (affichés une seule fois, PDF chiffré téléchargeable)
- **Backup codes** : stockés hashés bcrypt, one-shot, regénération possible (invalide les anciens)
- **Lost-all-access recovery** : CLI `ploydok-cli admin-recovery` (shell root VPS requis) → régénère token enrollment 15 min + invalide toutes sessions + event audit `EMERGENCY_RECOVERY` (rouge permanent)
- **Pas de recovery par email, pas de support** (self-hosted, passkey-first)

### 1.5-bis Session management
- Page `/settings/security/sessions` : liste sessions actives (device, IP, user-agent, last_seen)
- Révocation individuelle ou « sign out all other devices »
- Page `/settings/security/passkeys` : ajout/révocation, re-challenge passkey pour révoquer
- Impossible de révoquer la dernière passkey sans backup codes actifs

### 1.6 Layout UI
- Shell : topbar (user menu + logout), sidebar (Projects, Apps, Databases, Copilot, Settings), main
- Route `/login` avec bouton « Sign in with passkey »
- Route `/dashboard` protégée, affiche juste « Welcome, <user> »
- Thème dark par défaut (toggle dispo)

### 1.7 Gouvernance repo & licence
- `LICENSE` : **AGPL-3.0-only** (texte officiel)
- `NOTICE` : copyright + contributors
- `SECURITY.md` : politique disclosure (email + PGP key), SLA triage 72h
- `CONTRIBUTING.md` : setup dev, DCO obligatoire (Developer Certificate of Origin)
- `CODE_OF_CONDUCT.md` : Contributor Covenant 2.1
- `.github/ISSUE_TEMPLATE/` : bug, feature, security (redirige vers SECURITY.md)
- `.github/PULL_REQUEST_TEMPLATE.md`
- Header SPDX `SPDX-License-Identifier: AGPL-3.0-only` sur tout fichier source (lint script vérifie)

### 1.8 CI GitHub Actions
- Job `ci` : `bun install` → `bun lint` → `bun typecheck` → `bun test`
- Cache Bun
- Bloquer merge si rouge
- Dependabot pour deps critiques (security, weekly)

---

## Deliverable démo

Video 2 min :
1. `bun dev` lance web + api
2. Register passkey depuis browser
3. Login passkey
4. Dashboard vide s'affiche
5. CI passe sur un PR factice

---

## Definition of Done

- [ ] Preset shadcn initialisé correctement (`components.json` présent)
- [ ] 5 packages/apps compilent (`bun typecheck` vert)
- [ ] Drizzle migration appliquée sans erreur
- [ ] Register + login passkey fonctionnent sur Chrome/Safari
- [ ] Backup codes générés, téléchargeables, consommables one-shot
- [ ] Multi-device enforcement actif (action critique bloquée sans 2nd facteur)
- [ ] Session management : liste, révocation, sign-out-all OK
- [ ] `admin-recovery` CLI testé (régénère token, log audit rouge)
- [ ] Cookies flags vérifiés (DevTools)
- [ ] Fichiers gouvernance tous présents (LICENSE AGPL-3.0-only, SECURITY.md, etc.)
- [ ] Lint SPDX headers vert
- [ ] CI verte sur `main`
- [ ] README racine : comment lancer en local en < 5 min

---

## Risques sprint

| Risque | Mitigation |
|---|---|
| Preset `bgm023GIT` incompatible monorepo Bun | Vérifier avec shadcn skill avant Sprint 1, PoC en J1 |
| WebAuthn complexe à debug cross-browser | Commencer par Chrome, Safari en J4-5 |
| Drizzle schema à refaire | Schema v1 volontairement minimal, itérer |
