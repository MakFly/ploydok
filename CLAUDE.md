# AGENTS.md — Ploydok

This file is the repo-level agent guide for Codex-style coding agents. Keep it focused on durable, repo-specific instructions: how the codebase is organized, which commands are safe, what must be validated, and which invariants must not be broken.

## Scope And Precedence

- This file applies to the whole repository.
- If a deeper `AGENTS.md` exists in a subdirectory, the deeper file takes precedence for files under that subtree.
- Direct user or system instructions override this file.

## Roadmap — suivre le plan par sprint

- La roadmap v1.0 est décrite dans `docs/sprints/README.md`. Elle est **la source de vérité** : toute décision de prio/scope passe par là.
- **Toujours travailler dans l'ordre des sprints**. Quand le sprint N est mergé (code + DoD validée e2e), attaquer N+1 ; ne pas piocher dans N+2 ou post-v1 "parce que c'est cool".
- Avant de démarrer un sprint, relire son fichier `docs/sprints/sprint-<N>-*.md` (scope, DoD, risques) + le `PLAN-sprint-<N>.md` dans `docs/plans/` s'il existe.
- Si un besoin utilisateur sort de la roadmap : proposer d'abord de l'insérer dans le sprint courant ou futur (avec mise à jour des .md), pas de travailler hors-plan silencieusement.
- Hors-scope explicites (marqués "Non-couvert" dans un sprint) : ne pas les commencer sans que l'utilisateur déplace la feature dans un sprint actif.
- Statuts possibles dans `docs/sprints/README.md` : `✅ Terminé`, `✅ Code · ⏳ e2e`, `⚠️ Partiel`, `⏳ À faire`. Mettre à jour la colonne Statut + le titre H1 du fichier sprint à chaque transition réelle (preuve concrète : test vert, commit mergé).

## Repository Shape

- Monorepo layout:
  - `apps/web`: TanStack Start + TanStack Router frontend
  - `apps/api`: API server
  - `packages/*`: shared packages
  - `agent/*`: Rust agent / CLI
  - `infra/*`: local infra and deployment helpers
  - `docs/*`: product, ADRs, plans, runbooks
- Frontend tests:
  - unit/light integration tests live in `apps/web/src/tests`
  - Playwright e2e tests live in `apps/web/e2e`

## Search And Read Workflow

- Prefer `ig` over `rg` or `grep` for repo search.
- Useful commands:
  - `ig "pattern" apps/web`
  - `ig read path/to/file --signatures`
  - `ig smart apps/web/src`
  - read `.ig/context.md` for a repo overview before broad exploration
- Fall back to `rg` only if `ig` is unavailable or insufficient.

## Non-Negotiable Runtime Rules

- Do not start, restart, or kill long-running dev servers.
- Forbidden examples:
  - `make dev`
  - `bun run dev`
  - `bun run build --watch`
  - `nohup ...`
  - killing the API or web dev process
- The user owns long-running processes. If a restart is needed, tell the user which command to run instead of doing it yourself.
- Safe one-shot commands are allowed: typecheck, unit tests, lint, targeted scripts, migrations, `curl` against an already-running service.

## Local Environment Facts

- Reserved local ports:
  - API: `3335`
  - Web: `5173`
  - Caddy: `8180`, `8543`, `2020`
- Agent socket: `/tmp/ploydok-agent.sock`
- Do not touch ports `80`, `443`, or `3000` on this machine.
- Local dev secrets live in `apps/api/.env.local`.
- Do not regenerate local auth secrets unless the user explicitly asks; that invalidates active JWTs/sessions.

## Auth And SSR Invariants

- Auth cookies:
  - `ploydok_access`: 10 minutes, HttpOnly
  - `ploydok_refresh`: 7 days, HttpOnly
  - `SameSite=Lax`
  - `Secure` only in production
- Refresh flow:
  - frontend auto-retries exactly once on `401` via `/auth/refresh`
  - `/auth/refresh` is exempt from CSRF server-side because it relies on the refresh cookie
- SSR in `apps/web`:
  - `apiFetch` must forward request cookies through `@tanstack/react-start/server`
  - auth decisions in route guards must remain request-scoped in SSR
  - `GET /me` deduplication is allowed on the client, but must not leak across SSR requests
- Route guard semantics:
  - `401` / expired session => auth redirect
  - infra errors (`5xx`, network, malformed response) => surface to error boundaries, not fake-login redirects

## Code Placement And Change Style

- Keep changes local to the subsystem you are modifying.
- Prefer extending existing modules over creating parallel abstractions.
- Do not introduce state management libraries or app-wide context unless there is a clear, demonstrated need.
- For frontend state:
  - prefer local state first
  - use existing query/cache mechanisms before adding new global state
  - use Zustand only if a shared client store is genuinely required
- Remove dead code created by your change. Do not leave behind unused helpers, compatibility shims, or stale tests.

## Validation Commands

- Prefer targeted validation for the area you changed before broader checks.
- Common web commands:
  - `bun test apps/web/src/tests/`
  - `bunx tsc -p apps/web/tsconfig.json --noEmit`
- Monorepo/root commands may exist, but do not run broad expensive suites unless the task warrants it.
- Before any push or PR-style completion, the relevant Definition of Done must be satisfied with real validation, not just inspection.

## Sprint Tracking (docs/sprints/)

- **Toujours utiliser des checkboxes Markdown `- [ ]` / `- [x]`** pour chaque feature / item DoD d'un sprint. Pas de prose, pas de puces simples : le statut doit être scannable en un coup d'œil.
- Quand un sprint est réellement terminé (code mergé + DoD validée bout-en-bout), ajouter `✅ Terminé` directement dans le titre H1 du fichier `docs/sprints/sprint-N-*.md` et dans la colonne Statut de `docs/sprints/README.md`.
- Statuts possibles dans le titre : `✅ Terminé`, `✅ Code · ⏳ e2e` (code mergé, e2e pas encore exécutés), `⚠️ Partiel`, `⏳ À faire`.
- Cocher un item DoD uniquement quand preuve concrète existe (test vert, endpoint audité, commit référencé). Pas de coche par optimisme.
- Maintenir le tableau `docs/sprints/README.md` à jour à chaque transition de statut — c'est la source de vérité roadmap.

## Git And Delivery Rules

- Do not create branches unless the user explicitly asks.
- Do not amend existing commits unless explicitly asked.
- Do not revert unrelated user changes.
- Keep the worktree intentional and easy to review.
- If you used a temporary Claude/Codex worktree under `.claude/worktrees/*` for implementation, remove it once the work is finished and no handoff still depends on it.
- If you are preparing code for handoff, summarize exactly what was validated and what was not.

## Repo-Specific References

- Read these only when relevant to the task:
  - `.claude/rules/commands.md`
  - `.claude/rules/monorepo.md`
  - `.claude/rules/auth.md`
  - `.claude/rules/db.md`
  - `.claude/rules/testing.md`
  - `.claude/rules/commits.md`
  - `.claude/rules/style.md`
  - `.claude/rules/agent-rust.md`
  - `.claude/rules/infra.md`

## What Good Agent Work Looks Like Here

- Search the real code before deciding.
- Respect the auth and SSR invariants above.
- Make small, reviewable patches.
- Add or update regression tests when fixing logic bugs.
- Prefer precise commands and concrete file references over generic advice.
