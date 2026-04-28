# PLAN — Sprint 1 Fondations (tâches 1.2 → 1.8)

> Contexte complet : `docs/PRD.md`, `docs/sprints/sprint-1-fondations.md`.
> Tâche 1.1 (init monorepo shadcn preset `bgm023GIT`) déjà faite.

## Stack figée (non négociable)
- Bun + Hono (API), Drizzle + `bun:sqlite`, SQLCipher plus tard
- WebAuthn via `@simplewebauthn/server` + `@simplewebauthn/browser`
- TanStack Start + shadcn (web, déjà scaffolded)
- Cargo Rust pour recovery CLI (`agent/ploydok-cli/`)
- Licence AGPL-3.0-only, header SPDX sur chaque source
- Cookies `httpOnly; Secure; SameSite=Strict`
- `bun`/`bunx --bun` uniquement — jamais npm/yarn/pnpm

## Waves (dépendances)

### Wave 1 (parallèle) — foundation
- **1.2 workspaces** : créer `apps/api/` (Bun+Hono vide + tsconfig), `packages/db/`, `packages/shared/`, `packages/agent-proto/` avec `package.json` minimal, tsconfig, un test bun qui passe. Racine : ajouter scripts `db:migrate`, `db:generate`. Ajouter `@types/bun`, `typescript` au niveau nécessaire.
- **1.7 gouvernance** : `LICENSE` (AGPL-3.0-only texte officiel), `NOTICE`, `SECURITY.md`, `CONTRIBUTING.md` (DCO), `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), `.github/ISSUE_TEMPLATE/{bug,feature,security}.md`, `.github/PULL_REQUEST_TEMPLATE.md`, script `scripts/check-spdx.ts` qui vérifie header SPDX sur `**/*.{ts,tsx,rs}`.

### Wave 2 (parallèle, dépend de 1.2) — couches indépendantes
- **1.3 db** dans `packages/db/` : drizzle schema v1 (`users, sessions, passkeys, projects, apps, secrets, audit_log`), migrations via `drizzle-kit`, client `bun:sqlite`, seed dev (1 user, 1 project), tests CRUD basiques. `audit_log` avec colonne `prev_hash` pour chainage futur.
- **1.4 api** dans `apps/api/` : Hono, middlewares logger / CORS strict / CSRF (double-submit token) / error handler, routes stubs `/health`, `/me`, `/auth/*` (placeholders 501), `src/env.ts` validé par zod, master key via `keytar` avec fallback `.env`. Test Hono sur `/health`.
- **1.8 CI** : `.github/workflows/ci.yml` (install bun, `bun install --frozen-lockfile`, `bun lint`, `bun typecheck`, `bun test`, `scripts/check-spdx.ts`). Job sur `pull_request` + push `main`. Cache Bun. `dependabot.yml` weekly npm + github-actions.

### Wave 3 (séquentiel, dépend de 1.3 + 1.4)
- **1.5 auth passkey + recovery** :
  - Server routes `/auth/register/{options,verify}`, `/auth/login/{options,verify}`, `/auth/logout`, `/auth/refresh`, `/auth/backup-codes/{generate,consume}`, `/auth/passkeys/{list,add,remove}`, `/auth/sessions/{list,revoke,revoke-others}`.
  - JWT access 10 min + refresh 7j rotatif, stockés en cookies sécurisés.
  - Backup codes : 10 codes, bcrypt, one-shot, regénération invalide anciens. PDF téléchargeable (lib `pdfkit` ou équivalent Bun).
  - Multi-device enforcement : middleware `requireSecondFactor` (bloque si <2 passkeys ET pas de backup codes actifs).
  - Recovery CLI : crate Rust dans `agent/ploydok-cli/`, commande `admin-recovery` qui (a) nécessite shell root, (b) se connecte en direct à la DB SQLite via chemin config, (c) génère token enrollment 15 min (random 32 bytes base64url), (d) invalide toutes sessions, (e) insère audit `EMERGENCY_RECOVERY`. Utiliser `rusqlite` + `clap`. Tests cargo.

### Wave 4 (dépend de 1.5)
- **1.6 UI layout + session mgmt** dans `apps/web/` :
  - Shell : `components/layout/{Topbar,Sidebar,AppShell}.tsx` (shadcn), sidebar : Projects, Apps, Databases, Copilot, Settings.
  - `/login` : bouton passkey (`@simplewebauthn/browser`).
  - `/dashboard` : protégé, « Welcome, <user> » + warning multi-device si <2 facteurs.
  - `/settings/security/sessions` : liste + révocation.
  - `/settings/security/passkeys` : liste + add/remove (re-challenge).
  - Dark theme par défaut + toggle.
  - Client auth : Tanstack Query hooks `useMe`, `useSessions`, `usePasskeys`.

## Règles communes agents
1. Chaque agent travaille dans son worktree, sur branche `sprint-1/<task-id>`.
2. Header SPDX `// SPDX-License-Identifier: AGPL-3.0-only` sur tout fichier source créé.
3. Commit atomique par tâche : `feat(sprint-1): <task> — <summary>` + trailer `Co-Authored-By`.
4. Tests : chaque package modifié doit avoir au moins 1 test qui passe via `bun test` (ou `cargo test` pour Rust).
5. Pas de secret en clair dans le code. Cookies flags vérifiés.
6. Pas de feature hors scope. TODO en `docs/adr/` si manque détecté.
7. Après chaque tâche : typecheck + test + lint verts avant merge.

## Merge strategy
- Merge worktrees dans `main` en fin de wave (fast-forward quand possible, sinon merge commit).
- À la fin : ADR `docs/adr/0001-stack-choices.md` résumant décisions clés (SQLite, Bun, AGPL, passkey-only).
- README racine mis à jour : install < 5 min, `bun install && bun db:migrate && bun dev`.

## DoD Sprint 1 (rappel)
- `bun typecheck` vert sur tous packages
- Drizzle migration appliquée sans erreur
- Register + login passkey fonctionnent
- Backup codes one-shot OK
- Multi-device enforcement actif
- Session management liste/revoke OK
- `admin-recovery` CLI testé (cargo test)
- Cookies flags vérifiés
- Gouvernance complète + lint SPDX vert
- CI verte sur main
- README < 5 min
