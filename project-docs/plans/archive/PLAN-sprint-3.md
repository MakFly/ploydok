# PLAN — Sprint 3 : Deploy from Git

## Vue d'ensemble

Sprint 3 connecte un repo GitHub à un domaine live en moins de 2 minutes. Il s'appuie sur l'auth (S1), l'agent Rust/Caddy (S2), et les schemas Drizzle existants. Les 9 sous-tâches couvrent : l'abstraction `GitProvider`, le flux OAuth GitHub, la sélection de repo, un worker SQLite maison, la détection Dockerfile/Nixpacks, BuildKit rootless avec cache, un registry local avec GC, le blue-green Caddy, l'UI `/apps/:id` avec WebSocket logs, et un bouton deploy manuel. Quatre waves parallélisables permettent à 4 agents de travailler sans collision de fichiers.

---

## Pré-requis infra locale

- **buildkitd** : `moby/buildkit:rootless`, socket `/run/ploydok/buildkitd.sock`, volume buildcache.
- **registry:2** : bind `127.0.0.1:5000`, volume `~/.ploydok-dev/registry` (dev) ou `/var/lib/ploydok/registry` (prod), auth htpasswd keyring.
- **Réseau** : `ploydok-public` déjà créé par l'API au boot.
- **Workspace** : `~/.ploydok-dev/builds/` (dev) ou `/var/lib/ploydok/builds/` (prod) via `PLOYDOK_BUILD_DIR`.
- **Env vars ajoutées** à `apps/api/.env.local` : `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`, `PLOYDOK_REGISTRY_URL=127.0.0.1:5000`, `PLOYDOK_REGISTRY_USER`, `PLOYDOK_REGISTRY_PASS`, `PLOYDOK_BUILD_DIR`, `PLOYDOK_BUILDKIT_SOCKET`.

---

## Wave 1 — Fondations (parallèle, 0 dépendances inter-agents)

### M1.1 — git-provider-abstraction

**Goal** : Poser l'interface `GitProvider` et ses types partagés.

**Files owned (exclusivement)** :
- `packages/shared/src/git-providers.ts`
- `packages/shared/src/apps.ts`
- `packages/shared/src/index.ts`
- `packages/shared/src/git-providers.test.ts`
- `packages/shared/src/apps.test.ts`

**Tasks** :
- [ ] Interface `GitProvider` : `listRepos(token, page, perPage)`, `getRepo(token, fullName)`, `getDefaultBranch(token, fullName)`, `cloneUrl(fullName, token)`.
- [ ] Types : `GitRepo`, `GitProviderKind = 'github'` (extensible).
- [ ] Schemas Zod : `AppStatus`, `BuildStatus`, `BuildMethod`, `AppConfig`, `HealthcheckConfig`, `Build`, `JobStatus`.
- [ ] Exports depuis `index.ts`. SPDX headers.

**Tests** : imports types + validation Zod round-trip.

---

### M1.2 — db-schema-sprint3

**Goal** : Étendre schema Drizzle + queries worker.

**Files owned** :
- `packages/db/src/schema/apps.ts` (modification)
- `packages/db/src/schema/builds.ts`
- `packages/db/src/schema/jobs.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/queries/builds.ts`
- `packages/db/src/queries/jobs.ts`
- `packages/db/src/queries/builds.test.ts`
- `packages/db/src/queries/jobs.test.ts`
- `packages/db/migrations/0001_sprint3_deploy.sql`

**Tasks** :
- [ ] Ajouter colonnes à `apps` : `git_provider`, `repo_full_name`, `branch`, `root_dir`, `dockerfile_path`, `install_command`, `build_command`, `start_command`, `watch_paths` (JSON), `container_id`, `domain`, `build_method`, `healthcheck_*` (6 colonnes).
- [ ] Table `builds` : id, app_id FK, status, build_method, image_tag, container_id, commit_sha, timestamps, log_path.
- [ ] Table `jobs` : id, type, payload JSON, status, run_at, created_at, updated_at. Table `job_runs`.
- [ ] Queries : `enqueue`, `pickNext` (BEGIN IMMEDIATE + UPDATE WHERE status='pending' LIMIT 1), `markDone`, `markFailed` + CRUD builds.
- [ ] Migration via `bun run db:generate` si disponible, sinon SQL manuel.

**Tests** : pickNext concurrence, FK cascade.

---

### M1.3 — infra-registry-buildkit

**Goal** : Docker compose + Makefile + runbook infra S3.

**Files owned** :
- `infra/docker-compose.yml` (modification — ajout services)
- `infra/registry/config.yml`
- `infra/registry/.gitkeep`
- `infra/buildkit/.gitkeep`
- `Makefile` (modification — ajout targets)
- `project-docs/operations/runbooks/sprint3-infra-setup.md`
- `scripts/smoke-registry.sh`

**Tasks** :
- [ ] Service `buildkitd` : `moby/buildkit:rootless`, security_opt seccomp=unconfined, user 1000:1000, volume buildcache.
- [ ] Service `registry` : image `registry:2`, bind `127.0.0.1:5000`, volume registry-data, bind config.yml.
- [ ] `registry/config.yml` : `storage.delete.enabled: true`, `http.addr: :5000`.
- [ ] Targets Makefile : `infra-buildkit-logs`, `infra-registry-logs`, `registry-gc`.
- [ ] Runbook : génération htpasswd, stockage keyring, dev mapping `~/.ploydok-dev/`.
- [ ] Smoke test `scripts/smoke-registry.sh` : login, push hello-world, tags list.

**Tests** : smoke-registry.sh exécutable.

---

### M1.4 — api-env-and-routing-scaffold

**Goal** : Env vars + routers stubs pour /github, /apps, /ws.

**Files owned** :
- `apps/api/src/env.ts` (modification)
- `apps/api/src/app.ts` (modification — register routers)
- `apps/api/src/routes/github.ts` (stubs 501)
- `apps/api/src/routes/apps.ts` (stubs 501)
- `apps/api/src/routes/ws.ts` (stub WS upgrade)

**Tasks** :
- [ ] `env.ts` : ajouter `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`, `PLOYDOK_REGISTRY_URL`, `PLOYDOK_REGISTRY_USER`, `PLOYDOK_REGISTRY_PASS`, `PLOYDOK_BUILD_DIR`, `PLOYDOK_BUILDKIT_SOCKET`. Tous optionnels en dev.
- [ ] `app.ts` : monter `githubRouter` sur `/github`, `appsRouter` sur `/apps`, `wsRouter` sur `/ws`. Protéger via `requireAuth(db)`. NE PAS toucher les routes existantes.
- [ ] Stubs 501 avec TODO clairs pour M2.1, M2.2, M3.2.

**Tests** : `index.test.ts` existant reste vert. Nouveaux endpoints répondent 501/401.

---

## Wave 2 — OAuth + Build Detection (dépend de Wave 1)

### M2.1 — github-oauth-and-repo-list
**Files owned** : `apps/api/src/routes/github.ts`, `apps/api/src/github/client.ts`, `apps/api/src/github/cache.ts`, tests associés.
**Tasks** : OAuth flow + callback + state CSRF, `GitHubProvider implements GitProvider`, cache ETag 5min, endpoints `/github/auth/*` + `/github/repos`.

### M2.2 — app-create-and-config
**Files owned** : `apps/api/src/routes/apps.ts`, `apps/api/src/routes/apps.test.ts`.
**Tasks** : POST/GET/PATCH/DELETE `/apps`, validation Zod avec tous les champs monorepo + healthcheck.

### M2.3 — build-detection-worker-scaffold
**Files owned** : `apps/api/src/worker/index.ts`, `apps/api/src/worker/git.ts`, `apps/api/src/worker/detect.ts`, `apps/api/src/worker/nixpacks.ts`, `apps/api/src/worker/handlers/deploy.ts`.
**Tasks** : polling loop jobs SQLite, clone shallow, detect Dockerfile/Nixpacks, orchestration handler.

### M2.4 — web-github-connect-ui
**Files owned** : `apps/web/src/routes/settings/github.tsx`, `apps/web/src/routes/apps.tsx`, `apps/web/src/components/apps/CreateAppModal.tsx`, `apps/web/src/components/apps/RepoSelector.tsx`, `apps/web/src/lib/github.ts`, `apps/web/src/components/layout/Sidebar.tsx` (modification).
**Tasks** : page Connect GitHub, modal Create App, RepoSelector infinite query.

---

## Wave 3 — BuildKit + Blue-Green + Streaming (dépend de Wave 2)

### M3.1 — buildkit-push-registry
**Files owned** : `apps/api/src/worker/buildkit.ts`, `apps/api/src/worker/registry.ts`, `apps/api/src/worker/handlers/deploy.ts` (extension).
**Tasks** : `buildctl` wrapper avec cache-from/to, push registry, GC policy keep=3, diskGuard 80%.

### M3.2 — websocket-log-streaming
**Files owned** : `apps/api/src/routes/ws.ts`, `apps/api/src/worker/log-bus.ts`, `apps/api/src/routes/apps.ts` (ajout GET logs).
**Tasks** : LogBus in-memory pub/sub, WS `/ws/apps/:id/build/:buildId` + `/ws/apps/:id/logs`, download logs archivés.

### M3.3 — blue-green-caddy-healthcheck
**Files owned** : `apps/api/src/worker/runner.ts`, `apps/api/src/caddy/client.ts` (ajout setUpstream), `apps/api/src/routes/apps.ts` (rollback/stop/restart).
**Tasks** : run container + healthcheck poll + Caddy switch + grace 30s + stop old + rollback endpoint.

### M3.4 — web-apps-detail-page
**Files owned** : `apps/web/src/routes/apps.$id*.tsx` (6 routes), `apps/web/src/components/apps/BuildLogViewer.tsx`, `apps/web/src/components/apps/AppStatusBadge.tsx`, `apps/web/src/lib/apps.ts`.
**Tasks** : layout + 6 tabs (Overview/Logs/Builds/Settings/Env/Domains), WS log viewer, bouton Deploy/Rollback.

---

## Wave 4 — UI Polish + E2E (dépend de Wave 3)

### M4.1 — e2e-playwright
**Files owned** : `apps/web/e2e/sprint3-*.spec.ts` (3 specs), `apps/web/playwright.config.ts` (timeout).
**Tasks** : deploy flow < 2min, zero-downtime assertion, rollback < 10s.

### M4.2 — registry-gc-dashboard
**Files owned** : `apps/api/src/worker/handlers/gc-registry.ts`, `apps/api/src/routes/apps.ts` (registry-usage endpoint), `apps/web/src/routes/apps.$id.overview.tsx` (widget).
**Tasks** : cron 04:00 UTC, widget UI, bouton prune now.

---

## Definition of Done

- [ ] `bun typecheck` + `bun test` verts
- [ ] `cargo check -p ploydok-agent` vert
- [ ] Deploy Next.js Dockerfile OK
- [ ] Deploy Next.js Nixpacks OK
- [ ] Deploy FastAPI Python Nixpacks OK
- [ ] Deploy monorepo root_dir + overrides OK
- [ ] Cache : 2e build < 40% du temps 1er
- [ ] Zero-downtime : test `sprint3-zero-downtime.spec.ts` passe (0 5xx)
- [ ] Healthcheck custom respecté
- [ ] Logs streamés latence < 500ms
- [ ] Rollback < 10s
- [ ] Builds rootless (inspect pas --privileged)
- [ ] Cleanup workspace + GC images auto
- [ ] E2E Playwright `sprint3-deploy.spec.ts` < 2min
- [ ] SPDX headers sur tous les nouveaux fichiers
