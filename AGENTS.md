# AGENTS.md — Ploydok

This file is the repo-level agent guide for Codex-style coding agents. Keep it focused on durable, repo-specific instructions: how the codebase is organized, which commands are safe, what must be validated, and which invariants must not be broken.

## Scope And Precedence

- This file applies to the whole repository.
- If a deeper `AGENTS.md` exists in a subdirectory, the deeper file takes precedence for files under that subtree.
- Direct user or system instructions override this file.

## Références externes (benchmark UX/feature parity)

Deux repos clonés localement servent de référence pour aligner Ploydok sur l'état de l'art self-hosted PaaS. À consulter avant de concevoir une nouvelle feature, refondre la sidebar, ou trancher un choix UX :

- `/tmp/dokploy` — Dokploy (Next.js + tRPC + Drizzle + Docker Swarm). Cible principale pour la sidebar, l'orga des routes, le découpage des settings, et les flows app/database/compose.
- `/tmp/coolify` — Coolify (Laravel + Livewire + PHP). Cible pour la richesse fonctionnelle (notifications, destinations, sources, teams, backups, terminal in-browser, S3 storages).

Règles d'usage :

- Ne **jamais** copier-coller du code (licences différentes, stacks différentes). Lire pour s'inspirer du modèle, pas pour le porter.
- Quand on cite une idée venant de l'un des deux, le préciser dans le commit/PR (`Inspired by dokploy/<path>`).
- Si l'un des deux clones manque, le re-cloner : `git clone --depth 1 https://github.com/Dokploy/dokploy.git /tmp/dokploy` et `git clone --depth 1 https://github.com/coollabsio/coolify.git /tmp/coolify`.

## Repository Shape

- Monorepo layout:
  - `apps/web`: TanStack Start + TanStack Router frontend
  - `apps/api`: API server
  - `packages/*`: shared packages
  - `agent/*`: Rust agent / CLI
  - `infra/*`: local infra and deployment helpers
  - `installer/*`: VPS installer and host descriptors
  - `scripts/*`: one-shot tooling and validation scripts
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

## Database Migrations

- Before introducing schema-dependent code, verify the migration exists, is listed in `packages/db/migrations/meta/_journal.json`, and has a strictly newer `when` than migrations already applied in the target local database.
- After adding or changing migrations, run `bun --env-file=apps/api/.env.local run db:migrate` against the local dev database when the task is meant to be testable locally.
- After migration, verify the real database shape, not only TypeScript schema files. Use `information_schema.columns` / `information_schema.tables` or a targeted query against the new columns/tables.
- If a schema object was added in a migration whose journal `when` is older than already-applied migrations, add a new idempotent drift-repair migration instead of editing history that may already be applied elsewhere.
- For API routes that select whole tables, test at least one real query path after migration; missing columns should be caught before handing back UI work.

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


<claude-mem-context>
# Memory Context

# [ploydok] recent context, 2026-05-10 2:59am GMT+2

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (19,655t read) | 181,770t work | 89% savings

### May 9, 2026
S46 Deploy ploydok via SSH to production server, install in /var/www/, verify functionality, and report status to Discord (May 9, 12:56 AM)
S45 Install Ploydok on remote Debian server via SSH using GitHub bootstrap script and verify deployment (May 9, 12:56 AM)
S47 Achieve zero-bug fresh installation on default VPS by fixing installer automation, migrations, and service startup (May 9, 1:40 AM)
S48 Technical review and scoping of three post-installation work items: mTLS agent-API security, setup wizard routing, and image signature verification (May 9, 2:04 AM)
S52 Deploy ploydok to VPS via SSH installer, verify 100% operational status, investigate and resolve deployment issues, send completion report to Discord (May 9, 2:07 AM)
S53 How to access Ploydok deployed on Scaleway VPS behind firewall in coexist mode (May 9, 2:46 AM)
S55 Testing SSH tunnel access to Ploydok health endpoint on VPS (May 9, 2:55 AM)
S60 Attempted to add web frontend to Ploydok VPS deployment after diagnosing SSH access issue (May 9, 3:06 AM)
468 1:31p 🔵 Vite SSR build generates mismatched CSS asset references
469 1:32p 🔴 Patched SSR code to reference correct CSS asset hash from Nitro manifest
470 1:34p ✅ Successfully built web container with CSS hash normalization fix
471 " ✅ Deployed CSS-fixed web container to VPS production
472 " 🔵 Confirmed CSS 404 fix working in production
473 1:35p 🔵 API ingress reconciliation errors during fresh database initialization
474 " 🔵 Database migrations completed successfully with 53 tables created
475 " 🔵 Setup token authentication flow verified working
481 1:38p 🔵 Ploydok setup token and secret generation mechanism
482 1:39p 🟣 Added PLOYDOK_SETUP_TOKEN_AUTOFILL configuration flag
483 " ✅ Modified setup token endpoint security model for production use
484 1:40p ✅ Built production Docker image with setup token autofill feature
485 1:41p ✅ Deployed Docker image to VPS for setup token autofill testing
486 1:42p ✅ Deployed setup token autofill feature to production VPS
487 " 🔵 Verified setup token autofill works in production environment
488 " 🟣 Added Playwright test for remote setup page validation
489 1:44p 🔵 Validated setup page renders correctly with autofill enabled via Playwright browser test
490 " 🔵 Production deployment stable with setup token autofill feature active
491 2:50p 🔵 Installation issues: premature bootstrap and incorrect file ownership
492 2:51p 🔵 Database shows incomplete bootstrap: user created but no passkey registered
493 2:52p 🔴 Defer admin user creation until passkey registration completes
494 2:54p 🔴 Complete setup wizard atomicity fix with transaction-wrapped user creation
495 " 🔴 Installer now sets /opt/ploydok ownership to installing user instead of root
496 2:55p 🔄 Moved Caddyfile to installation directory and aligned volume configuration
497 " 🔄 Migrated stateful service data from host mounts to Docker named volumes
498 " 🔵 Installer test suite failing after Caddyfile relocation
499 2:56p 🔴 Updated installer test suite to match refactored directory structure
500 2:57p ✅ Built and tagged API Docker image with setup wizard atomicity fix
501 2:58p ✅ Transferred setup fix Docker image to production VPS
502 " ✅ Deployed setup fix to production and restarted API container
503 2:59p 🔴 Production deployment successful: orphaned admin user removed, setup wizard fixed
504 " 🔵 Production validation confirms complete fix: clean bootstrap state and correct ownership
505 " 🔵 Setup wizard atomicity fix verified: /options no longer creates database user
506 3:00p 🔵 Setup wizard flow timeout but atomicity preserved: database remains clean on failure
507 3:01p 🔵 WebAuthn client-side validation rejects IP-based RP ID: "212.47.249.36 is an invalid domain"
508 " 🔵 sslip.io DNS wildcard resolves IP-based hostnames for WebAuthn compatibility
509 3:02p ✅ Reconfigured production to use sslip.io domain for WebAuthn compatibility
510 3:03p 🔵 sslip.io configuration validated: IP redirects to domain, WebAuthn RP ID configured correctly
511 " 🔵 Setup wizard test times out even with sslip.io domain; database remains clean
512 3:04p 🔵 API container not reading WEBAUTHN_RP_ID from env file; still uses bare IP "212.47.249.36"
513 " 🔴 API container recreated with force flag to load WEBAUTHN_RP_ID environment variable
514 3:05p 🔵 Setup wizard WebAuthn flow succeeds: user created, TOTP page reached, but enrollment fails with 500 error
515 " 🔵 TOTP enrollment fails in prod: keyring requires D-Bus machine-id missing from Docker container
516 3:06p 🔴 Keyring fallback to MASTER_KEY env var in production when D-Bus unavailable
517 3:07p ✅ Built API Docker image with setup atomicity and keyring fallback fixes
**518** " ✅ **Transferred updated API image with both fixes to production VPS**
Transferred the complete setup wizard fix Docker image to production VPS server at 212.47.249.36. The compressed image archive (ploydok-api-setup-keyring.tar.gz) was securely copied to the remote /tmp directory using SCP, completing in 10.3 seconds. This image contains both critical fixes: the setup wizard atomicity refactoring that prevents orphaned user records, and the keyring fallback modification that enables TOTP secret encryption in containerized environments without D-Bus. The image is now staged on the production server, ready to be loaded into the local Docker registry and deployed to replace the current API container. Once deployed, this will enable the complete first-boot setup flow including WebAuthn passkey registration (via sslip.io domain) and TOTP enrollment (via MASTER_KEY env fallback).
~314t 🛠️ 1,007

**519** " ✅ **Production API deployed with complete setup wizard fixes and verified environment**
Successfully deployed updated API container to production VPS with complete first-boot setup wizard fixes. The deployment loaded the new Docker image, updated the compose configuration, and force-recreated the API container to ensure all environment variables loaded correctly. Environment verification inside the running container confirms all three critical variables are set: WEB_ORIGIN points to the sslip.io domain for proper WebAuthn RP ID derivation, WEBAUTHN_RP_ID explicitly specifies the domain to override any parsing issues, and MASTER_KEY is present to enable the keyring fallback for TOTP secret encryption in the containerized environment. The container started cleanly and is serving on port 3335. This deployment resolves all identified setup wizard issues: atomic user creation prevents orphaned records, sslip.io domain enables WebAuthn passkey registration, and env-based master key enables TOTP enrollment without D-Bus. The instance is now ready for complete end-to-end first-boot setup flow validation.
~438t 🛠️ 616

**520** 3:08p 🔵 **Complete setup wizard flow succeeds: passkey created, TOTP enrolled, all endpoints return 200**
Final end-to-end validation confirms complete setup wizard functionality on production VPS. The Playwright test successfully navigated through the entire first-boot flow using a virtual WebAuthn authenticator and the sslip.io domain configuration. The event log shows a clean progression: unauthenticated /me probe (401 expected), successful WebAuthn options generation (200), successful passkey verification with atomic user creation (200), and critically, successful TOTP enrollment (200). The /auth/totp/enroll endpoint, which was returning 500 errors due to keyring access failure, now succeeds because the loadMasterKey() function successfully falls back to the MASTER_KEY environment variable when D-Bus is unavailable in the container. The test user was successfully created with both a passkey and TOTP secret, then cleaned up by the test script, leaving the database in a pristine state ready for actual first-boot setup. This validates all three fixes working together: setup wizard atomicity prevents orphaned users, sslip.io domain enables WebAuthn in IP-addressed deployments, and keyring fallback enables TOTP encryption in containerized environments. The production instance is now fully functional for end users to complete first-boot setup.
~506t 🔍 2,519

**521** " 🔵 **Production system fully operational: all components healthy, instance ready for first-boot setup**
Final production validation confirms the VPS is fully operational and ready for end-user first-boot setup. The /health/ready endpoint reports all components green: database responding in 24ms, agent reachable at agent:50051, Caddy admin API accessible, and ingress routing correctly configured with 0 expected routes (clean install). The API container shows 51 seconds uptime after the latest deployment, running the vps-202605091512-setup-keyring image with all fixes. Instance state confirms bootstrapped=false with a pristine database (zero records in all auth tables). The setup token autofill feature is working via /auth/setup/dev-token, enabled by PLOYDOK_SETUP_TOKEN_AUTOFILL=1 for IP-restricted development access. The /setup page loads successfully via the sslip.io domain, and bare IP access correctly redirects (HTTP 302) to the domain for WebAuthn compatibility. File ownership in /opt/ploydok is correctly set to the debian user with restrictive permissions. The only log error is an expected non-blocking SMTP connection failure attempting to send a welcome email to the test user - mail functionality can be configured post-setup. The production instance is now fully validated and ready for actual first-boot wizard completion with all three fixes working: atomic user creation, WebAuthn via sslip.io, and TOTP enrollment via MASTER_KEY fallback.
~585t 🔍 4,303

**523** 3:19p 🟣 **Generated self-signed CA and TLS certificates for Ploydok server**
The Ploydok deployment now uses a self-signed certificate authority to issue TLS certificates for the control plane server. This resolves TLS certificate errors that were blocking WebAuthn support, as browsers require valid TLS to enable WebAuthn APIs. The implementation created a local CA with a 10-year validity, generated a server certificate covering both sslip.io hostname variants and the raw IP address, configured Caddy reverse proxy to serve the new certificate, and verified successful HTTPS connectivity. The CA certificate was downloaded to the local machine for potential browser trust store installation.
~393t 🛠️ 5,164


Access 182k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
