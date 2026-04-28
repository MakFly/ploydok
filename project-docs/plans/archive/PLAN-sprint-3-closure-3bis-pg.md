# PLAN — Sprint 3 closure + 3bis réduit + Postgres/Redis

> Audit : 2026-04-19.
> Scope consolidé : fermer Sprint 3, livrer 3bis (GitHub + GitLab + image Docker + registry auth + quotas + network-isolation-par-projet), câbler le webhook auto-deploy end-to-end, et migrer SQLite → Postgres (+ Redis) à l'iso Dokploy/Coolify.
> **Non-goals** : Gitea (sorti du scope), Sprint 4 secrets/domaines/DB-templates/rotation, Sprint 5 Copilot.

---

## 1. Audit de l'existant (ce qui est déjà en place)

| Domaine | Etat | Référence code |
|---|---|---|
| GitHub App Manifest flow | ✅ | `apps/api/src/github/manifest.ts`, `apps/api/src/routes/github.ts:361` |
| Webhook signature HMAC | ✅ | `apps/api/src/github/webhook.ts:35` |
| Push handler → enqueue `deploy.requested` | ✅ | `apps/api/src/github/webhook-handlers/push.ts:19` |
| Worker deploy (build + push + runBlueGreen) | ✅ | `apps/api/src/worker/handlers/deploy.ts`, `apps/api/src/worker/runner.ts:1` |
| Agent RPC `ContainerCreate` avec `ResourceLimits{cpu, memory_bytes}` | ✅ partiel | `packages/agent-proto/proto/agent.proto:31`, `agent/ploydok-agent/src/service.rs:150` |
| Agent RPC `NetworkCreate/NetworkRemove` | ✅ | `agent/ploydok-agent/src/service.rs:584` |
| `requireSecondFactor` middleware | ⚠️ présent mais non monté | `apps/api/src/auth/middleware.ts:127` |
| Healthcheck `start_period_s` | ⚠️ stocké mais non appliqué | `packages/db/src/schema/apps.ts:46`, `apps/api/src/worker/runner.ts:170` |
| Nixpacks cache `--cache-from/--cache-to` | ❌ absent | `apps/api/src/worker/nixpacks.ts` |
| UI Registry usage + Prune now | ❌ absent | — |
| BuildKit rootless audité | ⚠️ image rootless OK, `seccomp=unconfined` présent (à durcir), pas de script audit | `infra/docker-compose.yml:35` |
| DB | ❌ SQLite `bun:sqlite` | `packages/db/src/client.ts:1` |
| Queue | ❌ table `jobs` SQLite (polling) | `packages/db/src/schema/jobs.ts:4` |
| GitLab provider | ❌ absent | — |
| Deploy from Docker image | ❌ absent (`git_provider` enum = `['github']`) | `packages/db/src/schema/apps.ts:18` |
| Registry auth chiffré | ❌ absent | — |
| Quotas ressources par plan | ⚠️ champ proto `ResourceLimits` OK, rien en DB / UI | — |
| Network isolation per-project | ❌ absent (tous sur `ploydok-public`) | — |
| 11 specs DoD Playwright | ❌ `⊘ non exécuté` | `project-docs/roadmap/sprint-3-DoD.md` |

---

## 2. Objectifs du plan

### 2.A — Sprint 3 closure (R1–R6, PLAN-sprint-3-closure.md reste la référence)
Rien n'a été commité depuis la rédaction du plan closure. Ré-exécute ce qui est déjà détaillé là-bas, sans le dupliquer ici.

### 2.B — Sprint 3bis réduit
- 2 adapters Git : **GitHub (existant)** + **GitLab** (GitLab.com + self-hosted URL custom).
- Deploy from **Docker image** (`git_provider='image'`).
- **Registry credentials chiffrés** (DockerHub, GHCR, GitLab Registry, custom).
- **Quotas par plan** (nano / small / medium / large / custom) + enforcement instance-level + alertes >80 %.
- **Network isolation per-project** (`ploydok-proj-<project_id>` + test pentest).

### 2.C — Webhook auto-deploy bout-en-bout + test réel
- Push sur `MakFly/ploydok-hello` ou `MakFly/fixture-nextjs` → rebuild automatique en latest.
- Script `scripts/test-webhook-e2e.sh` qui déclenche un commit no-op sur le repo de test et vérifie `build.succeeded` + HTTP 200 sur le domaine Caddy en < 90 s.

### 2.D — Migration SQLite → Postgres + Redis (Dokploy/Coolify-style)
- **Postgres 16** : source de vérité (users, apps, builds, jobs-legacy, audit, sessions, secrets...).
- **Redis 7** : queue (BullMQ) + cache léger (tokens GitHub App, sessions hot, rate-limit).
- **Migration data** : script `scripts/migrate-sqlite-to-pg.ts` (idempotent, dry-run + apply).
- **Inspiration Dokploy** : `dokploy` infra = Postgres + Redis + Docker Swarm. On reste single-host (pas Swarm), donc : Postgres + Redis containerisés dans `infra/docker-compose.yml` + BullMQ pour les jobs.
- **Inspiration Coolify** : 1 DB Postgres unique, pas de sharding. Redis pour events pub/sub + cache. On reprend cette architecture.

---

## 3. Architecture cible Postgres + Redis

### 3.1 Compose (nouveau fichier `infra/docker-compose.yml`, ajout services)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: ploydok-postgres
    environment:
      POSTGRES_USER: ploydok
      POSTGRES_PASSWORD: ${PLOYDOK_PG_PASSWORD}          # obligatoire, pas de default
      POSTGRES_DB: ploydok
    ports:
      - "127.0.0.1:5432:5432"                            # bind loopback only
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ploydok"]
      interval: 5s
      retries: 10
    labels:
      ploydok.kind: infra
      ploydok.service: postgres
    networks: [ploydok]

  redis:
    image: redis:7-alpine
    container_name: ploydok-redis
    command: ["redis-server", "--requirepass", "${PLOYDOK_REDIS_PASSWORD}", "--appendonly", "yes"]
    ports:
      - "127.0.0.1:6379:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${PLOYDOK_REDIS_PASSWORD}", "ping"]
      interval: 5s
      retries: 10
    labels:
      ploydok.kind: infra
      ploydok.service: redis
    networks: [ploydok]

volumes:
  postgres-data:
  redis-data:
```

### 3.2 Drizzle

- Garder `packages/db/src/schema/*.ts` mais basculer `sqliteTable` → `pgTable` (driver `drizzle-orm/node-postgres` ou `drizzle-orm/postgres-js`).
- `packages/db/src/client.ts` :
  - `createDb(url)` switch sur `url.startsWith('postgres')` → pg driver, sinon fallback SQLite (temporaire, dégagé à la fin).
  - Exporte `createRedis()` séparément (`ioredis`).
- `DATABASE_URL` devient obligatoire au format `postgres://ploydok:pwd@localhost:5432/ploydok`.
- Variables env ajoutées : `REDIS_URL=redis://:pwd@localhost:6379/0`, `PLOYDOK_PG_PASSWORD`, `PLOYDOK_REDIS_PASSWORD`.

### 3.3 Jobs → BullMQ

- Remplacer la queue table `jobs` par BullMQ sur Redis.
- Queues :
  - `deploy` — payload `{appId, commitSha, commitMessage, installationId, deliveryId, buildId}`, attempts=1.
  - `gc.registry`, `cleanup.build`, `app.delete` — `attempts: 3, backoff: exponential`.
- Worker : `apps/api/src/worker/index.ts` monte 4 `Worker` BullMQ (1 par queue) + concurrency configurable.
- Historique jobs : table `job_history` Postgres (remplace `job_runs`) pour audit.
- Compat dev : garder la table `jobs` SQLite lisible en read-only pour le script de migration.

### 3.4 Redis usages secondaires

- Cache GitHub App installation tokens (TTL 55 min, sortie obligatoire avant expiry 1 h).
- Cache `/me` serveur-side (key `user:<id>`, TTL 60 s, invalidation sur mutation session).
- Rate-limit `POST /github/webhook` (sliding window 100 req/min/installationId).
- Pub/Sub `events` : SSE `/events` relaye les messages Redis → permet horizontal scale (on en a pas besoin en v1 mais ça évite de recâbler plus tard).

### 3.5 Sécurité infra

- `POSTGRES_HOST_AUTH_METHOD=scram-sha-256` par défaut dans Postgres 16.
- Pas d'exposition 0.0.0.0 — loopback uniquement.
- Mots de passe générés (`openssl rand -hex 32`) au premier `make infra-up` s'ils sont absents, stockés dans `apps/api/.env.local` (gitignored).

---

## 4. Waves d'exécution

### Wave 0 — Rebase Sprint 3 closure (R1–R6)

Déjà détaillé dans `PLAN-sprint-3-closure.md` (Waves 1-4). **Pré-requis** avant toute Wave 1 ici. Résumé :
- R1 : `requireSecondFactor` appliqué sur DELETE /apps/:id, rollback, stop, restart, redeploy, env, domains, registry prune.
- R2 : `pollHealthcheck` respecte `start_period_s`.
- R3 : `nixpacks.ts` expose `--cache-from/--cache-to`.
- R4 : widget `RegistryUsageWidget` + endpoint `POST /apps/:id/registry/prune`.
- R5 : `scripts/audit-rootless.sh` → exit 0 si buildkitd tourne en user 1000 + seccomp default.
- R6 : `PLOYDOK_E2E_REAL=1 bun scripts/run-dod.ts` : 11/11 verts.

### Wave 1 — Migration Postgres + Redis (fondations, blocante pour 3bis)

**Owner exclusif** : 1 agent (gros refacto cross-cutting, pas parallélisable).

#### 1.1 Compose + secrets
- `infra/docker-compose.yml` : ajout services `postgres` + `redis` (section 3.1).
- `Makefile` : `make infra-up` génère `PLOYDOK_PG_PASSWORD` / `PLOYDOK_REDIS_PASSWORD` dans `apps/api/.env.local` s'ils sont absents.
- `make db-migrate` pointe désormais sur Postgres.
- Runbook : `project-docs/operations/runbooks/postgres-redis-local.md`.

#### 1.2 Drizzle Postgres
- `packages/db/package.json` : ajout deps `drizzle-orm`, `postgres` (postgres-js driver, plus rapide et moins de deps que `pg`), `ioredis`.
- Chaque `packages/db/src/schema/*.ts` passe `sqliteTable` → `pgTable`. Types :
  - `integer({mode: 'timestamp'})` → `timestamp({ withTimezone: true })`.
  - `text` → `text` ou `varchar(N)` quand la longueur est bornée (ex: `id` → `uuid`).
  - `integer` → `integer` ou `bigint` selon (ex: `memory_bytes` → `bigint`).
- `packages/db/drizzle.config.ts` : driver `pg`.
- Générer `packages/db/migrations-pg/0000_init.sql` (nouveau répertoire, dossier `migrations/` SQLite figé en legacy).
- Client :
  ```ts
  // packages/db/src/client.ts
  export function createDb(url: string) {
    const sql = postgres(url, { max: 10, idle_timeout: 30 });
    return drizzle(sql, { schema });
  }
  export function createRedis(url: string) {
    return new Redis(url, { maxRetriesPerRequest: null });
  }
  ```
- `apps/api/src/env.ts` : `DATABASE_URL` exige `postgres://...` en prod, warn en dev si SQLite détecté.

#### 1.3 BullMQ queues
- `apps/api/src/worker/queues.ts` (nouveau) : expose `deployQueue`, `gcQueue`, `cleanupQueue`, `appDeleteQueue`.
- `apps/api/src/worker/index.ts` : monte 4 Workers BullMQ avec concurrency 1 par queue (évite collisions sur une même app).
- Adapter `enqueueJob` (appelé depuis routes + webhook handler) → délègue à la bonne queue BullMQ.
- Event bus Redis pub/sub (`events:app:<id>`) côté `eventBus.ts` si REDIS_URL set, sinon fallback in-mem (tests).

#### 1.4 Script migration
- `scripts/migrate-sqlite-to-pg.ts` : lit `./ploydok.db` + tous les autres `*.db` détectés → INSERT dans Postgres par batch 500.
- Flags : `--dry-run` (compte rows + prévisualise premières lignes), `--apply`, `--source <path>`.
- Idempotent : skip si `users.id` déjà présent.
- Test : seed SQLite (1 user + 1 app + 3 builds) → run `--apply` → diff row counts.
- Fallback : bug minoritaire → log + continue, rapport final.

#### 1.5 Tests & DoD Wave 1
- `bun test packages/db/` vert sur Postgres (spin-up container dans `beforeAll` via `testcontainers` Node OU connect à un `postgres:16-alpine` déjà up via `PLOYDOK_TEST_PG_URL`).
- `bun test apps/api/` vert (worker tests : mock BullMQ via in-memory adapter ou skip ceux qui requièrent Redis réel sous flag `PLOYDOK_TEST_REDIS_URL`).
- `bunx tsc` vert sur tous les packages.
- `make infra-up && make db-migrate && make dev` boot sans erreur.

**Non-goals Wave 1** : ne pas toucher à la logique métier (routes, worker deploy, runner). Juste le driver DB + queue.

---

### Wave 2 — Sprint 3bis (après Wave 1 mergée)

4 agents en parallèle sur fichiers disjoints.

#### 2.A Adapter GitProvider (interface + GitHub refacto)

**Owner** :
- `packages/shared/src/git-providers.ts` (nouveau — interface)
- `apps/api/src/providers/github.ts` (nouveau — wrap l'existant)
- `apps/api/src/providers/index.ts` (registre)

**Tâches** :
1. Interface :
   ```ts
   export interface GitProvider {
     readonly kind: 'github' | 'gitlab'
     listRepos(authCtx: AuthCtx, query?: string, page?: number): Promise<RepoList>
     listBranches(authCtx: AuthCtx, repoFullName: string): Promise<Branch[]>
     cloneUrl(authCtx: AuthCtx, repoFullName: string): string
     verifyWebhookSignature(payload: Buffer, headers: Record<string, string>, secret: string): boolean
     parseWebhookEvent(headers: Record<string, string>, payload: unknown): ParsedPushEvent | null
   }
   ```
2. Refacto `apps/api/src/routes/github.ts` : extraire le "core provider" dans `providers/github.ts`. Le router reste mince (HTTP parse + auth + appel provider).
3. Registre `providers/index.ts` : `getProvider(kind)` → instance singleton.
4. Tests : `providers/github.test.ts` reprend l'existant `webhook.test.ts` via interface.

**Non-goals** : pas d'endpoint nouveau. Juste refacto iso-fonctionnel.

---

#### 2.B Adapter GitLab

**Owner** :
- `apps/api/src/providers/gitlab.ts`
- `apps/api/src/routes/gitlab.ts`
- `apps/api/src/providers/gitlab.test.ts`
- `packages/db/src/schema/gitlab_config.ts` (nouveau — OAuth app credentials + instance URL)

**Tâches** :
1. Table `gitlab_config` : `instance_url`, `client_id`, `client_secret_enc`, `client_secret_nonce`, `created_at`. Re-use `github/app-credentials.ts` pour le chiffrement (clé MASTER_KEY).
2. Routes `/gitlab/*` symétriques à `/github/*` :
   - `POST /gitlab/config` (admin) — enregistre OAuth app + instance URL (default https://gitlab.com).
   - `GET /gitlab/connect` → redirect vers `{instance}/oauth/authorize` (state cookie HMAC).
   - `GET /gitlab/callback` → exchange code → store token chiffré côté user (table `gitlab_tokens`).
   - `GET /gitlab/repos?page=&search=` — liste `GET /api/v4/projects?membership=true&search=`.
   - `GET /gitlab/repos/:id/branches`.
   - `POST /gitlab/webhook` → vérif `X-Gitlab-Token` (secret HMAC propre par repo, stocké en DB).
3. Provider `gitlab.ts` :
   - `listRepos` : GET `{instance}/api/v4/projects?membership=true&simple=true&per_page=100&page=N`.
   - `listBranches` : GET `{instance}/api/v4/projects/:id/repository/branches`.
   - `cloneUrl` : injecte `oauth2:<token>@` dans `http_url_to_repo`.
   - `verifyWebhookSignature` : vérif header `X-Gitlab-Token` === secret stocké (GitLab ne fait pas HMAC par défaut, juste plain token ; on peut durcir en ajoutant notre HMAC applicatif par-dessus).
   - `parseWebhookEvent` : event `Push Hook` → `{repoFullName, branch, commitSha, commitMessage}`.
4. Schema `apps` : `git_provider` enum devient `['github', 'gitlab', 'image']` (migration). Ajouter `gitlab_project_id integer` (int côté GitLab, distinct du `repo_full_name`).
5. Adapter `webhook-handlers/push.ts` → `handlePush` générique (prend `provider` + `parsedEvent`). Créer `webhook-handlers/index.ts` qui route selon `X-Github-Event` vs `X-Gitlab-Event`.
6. UI web : `/settings/git-providers` (remplace `/settings/github`). Tabs : GitHub (existant) / GitLab (nouveau). Formulaire GitLab : URL instance + OAuth client ID/Secret + bouton "Connect".
7. Modal "Create app" : switch provider `[GitHub] [GitLab]` → liste repos correspondante.
8. Tests : 1 spec e2e `deploy-gitlab.spec.ts` (mock GitLab API via MSW ou un repo public gitlab.com si access).

**Non-goals** : pas de support Gitea. Pas de SAML/SSO pour GitLab self-hosted.

---

#### 2.C Deploy from Docker image

**Owner** :
- `packages/db/src/schema/apps.ts` (migration `git_provider` → add `'image'`, ajouter `image_ref`, `image_pull_policy`, `registry_credential_id`)
- `packages/db/src/schema/registry_credentials.ts` (nouveau)
- `apps/api/src/routes/apps.ts` (POST /apps accepte source `type: 'image'`)
- `apps/api/src/worker/handlers/deploy.ts` (branche `if app.git_provider === 'image'` : pas de clone + pas de build)
- `apps/api/src/worker/image-pull.ts` (nouveau — pull + retag + push registry privé)
- `packages/agent-proto/proto/agent.proto` (ajout champ `registry_auth` sur `ContainerCreateRequest`)
- `agent/ploydok-agent/src/service.rs` (honore `registry_auth` via bollard `CreateImageOptions`)

**Tâches** :
1. Migration Drizzle : `apps.image_ref text`, `apps.image_pull_policy text check in ('always','if_not_present')`, `apps.registry_credential_id uuid references(registry_credentials.id)`.
2. Table `registry_credentials` : `id`, `user_id`, `label`, `registry_host`, `username`, `password_enc`, `password_nonce`, `created_at`.
3. Route `POST /registry/credentials` (auth + requireSecondFactor) : chiffre password via `MASTER_KEY` + test connexion (fetch manifest dry-run `GET {registry}/v2/` avec auth basique).
4. Route `POST /apps` accepte `source: { type: 'image', image: string, pullPolicy?, credentialId? }`.
5. Worker :
   - Si `git_provider === 'image'` : skip clone + build. `image-pull.ts` fait `docker pull {image}` (via agent si possible, sinon local) → retag `registry:5000/<app_id>:<sha>` → push.
   - Puis `runBlueGreen` normal.
6. Auto-redeploy `:latest` : cron interne (BullMQ repeat job) poll toutes les 24 h (configurable), si digest différent → enqueue deploy. Opt-in par app (champ `apps.track_latest boolean default false`).
7. UI : carte "Deploy from image" dans le wizard `/apps/new` : champ image + tag + select credential.

**Non-goals** : pas de support Docker Compose multi-service (on ne déploie qu'une image). Pas de pull auto multi-platform.

---

#### 2.D Quotas ressources + Network isolation per-project

**Owner** :
- `packages/db/src/schema/apps.ts` (ajouter `cpu_limit float`, `mem_limit_bytes bigint`, `pids_limit integer`, `plan text`)
- `packages/db/src/schema/projects.ts` (ajouter `network_name text`)
- `packages/db/src/schema/instance_settings.ts` (nouveau — singleton row)
- `packages/agent-proto/proto/agent.proto` (ajouter `pids_limit` sur `ResourceLimits`)
- `agent/ploydok-agent/src/service.rs` (honorer `pids_limit` via bollard `HostConfig.pids_limit`)
- `apps/api/src/routes/apps.ts` (POST /apps accepte `plan`)
- `apps/api/src/worker/runner.ts` (inject quotas dans `ContainerCreateRequest`)
- `apps/api/src/projects.ts` (nouveau — helper `ensureProjectNetwork(projectId)` qui appelle `NetworkCreate` si absent)
- `apps/web/src/components/apps/PlanSelector.tsx`

**Tâches** :
1. Plans constants `packages/shared/src/plans.ts` :
   ```ts
   export const PLANS = {
     nano: { cpu: 0.25, memMB: 256, pids: 128 },
     small: { cpu: 0.5, memMB: 512, pids: 256 },
     medium: { cpu: 1, memMB: 1024, pids: 512 },
     large: { cpu: 2, memMB: 2048, pids: 1024 },
     custom: null,
   } as const
   ```
2. Migration `apps` : ajout colonnes + backfill apps existantes en `plan='custom'` avec `cpu=0, mem=0` (pas de limite). Idempotent via `INSERT ... ON CONFLICT DO NOTHING`.
3. Table `instance_settings` (1 row singleton) : `max_apps_per_user`, `max_total_memory_mb`, `max_total_cpu_cores`.
4. Enforcement :
   - `POST /apps` et `PATCH /apps/:id` : calculer somme apps du user (SQL agrégat) + plan demandé, refuse 422 si dépasse.
   - Dashboard `/monitoring/fleet` : jauge usage quotas par user.
5. Network per-project :
   - Helper `ensureProjectNetwork(projectId)` : si `projects.network_name IS NULL`, `agent.NetworkCreate({name: "ploydok-proj-" + projectId, driver: "bridge"})` → store `network_name`.
   - `runBlueGreen` utilise désormais `request.network = project.network_name` au lieu de `"ploydok-public"`.
   - Caddy reste sur un réseau partagé `ploydok-ingress` (nouveau, fixe). Chaque container est attaché à **2 réseaux** : son `ploydok-proj-X` (comm inter-services intra-projet) + `ploydok-ingress` (Caddy peut router). Proto `ContainerCreateRequest.network` devient `networks repeated string`.
   - `app.delete` → `NetworkRemove(ploydok-proj-X)` si plus aucune app.
6. Test pentest : spec `apps/web/e2e/isolation/cross-project-blocked.spec.ts` — 2 projets, user1 déploie app-A, user2 déploie app-B, `docker exec app-A curl http://app-B:8080` timeout (pas de résolution DNS entre réseaux).
7. Proto `ResourceLimits` : ajouter `int64 pids_limit = 3`. Regen stubs TS + Rust. `service.rs` branche sur `HostConfig.pids_limit`.
8. UI : `PlanSelector` (radio 5 options) dans wizard + /apps/$id/settings.

**Non-goals** : pas de billing, pas de plan payant. Quotas purement techniques.

---

### Wave 3 — Webhook auto-deploy E2E avec repo de test

**Dépend de** : Wave 2.A (refacto provider) + Wave 2.B partiel (pas obligatoire si repo de test est GitHub).

**Owner** :
- `scripts/test-webhook-e2e.sh` (nouveau — bash)
- `apps/web/e2e/webhook/github-autodeploy.spec.ts` (nouveau Playwright)
- `project-docs/operations/runbooks/test-webhook-real-repo.md`

**Pré-requis vérifiés côté infra** :
- GitHub App installée sur `MakFly` (visible via `/github/installations` selon `apps/api/src/routes/github.ts:245`).
- Repo cible accessible par l'App.
- API écoute en 4000, Caddy reçoit webhook via tunnel public (cloudflared OU ngrok — utilise celui que l'user a déjà).

**Tâches** :
1. Script `scripts/test-webhook-e2e.sh` :
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   REPO="${REPO:-MakFly/ploydok-hello}"     # ou fixture-nextjs
   BRANCH="${BRANCH:-main}"
   APP_ID="${APP_ID:?APP_ID required — export APP_ID=<uuid from DB>}"
   API="${API:-http://localhost:4000}"

   # 1. Baseline : build actuel
   BEFORE=$(curl -fsS "$API/apps/$APP_ID/builds" | jq -r '.builds[0].id // "none"')
   echo "latest build before: $BEFORE"

   # 2. Push commit no-op via gh CLI
   tmp=$(mktemp -d); cd "$tmp"
   gh repo clone "$REPO" .
   git checkout "$BRANCH"
   date > .ploydok-trigger
   git add .ploydok-trigger
   git commit -s -m "chore: webhook e2e $(date -Iseconds)"
   git push origin "$BRANCH"
   cd - >/dev/null; rm -rf "$tmp"

   # 3. Poll API jusqu'à nouveau build succeeded
   deadline=$(( $(date +%s) + 180 ))
   while [ $(date +%s) -lt $deadline ]; do
     LATEST=$(curl -fsS "$API/apps/$APP_ID/builds" | jq -r '.builds[0]')
     ID=$(echo "$LATEST" | jq -r '.id')
     STATUS=$(echo "$LATEST" | jq -r '.status')
     if [ "$ID" != "$BEFORE" ] && [ "$STATUS" = "succeeded" ]; then
       echo "new build OK: $ID"
       DOMAIN=$(curl -fsS "$API/apps/$APP_ID" | jq -r '.app.domain')
       curl -fsS -o /dev/null -w "%{http_code}\n" "http://$DOMAIN" | grep -q 200 && exit 0
     fi
     sleep 3
   done
   echo "TIMEOUT"; exit 1
   ```
2. Spec Playwright `apps/web/e2e/webhook/github-autodeploy.spec.ts` : identique mais via UI (create app → attendre build → push → attendre redeploy → assertion domaine répond 200).
3. Runbook `project-docs/operations/runbooks/test-webhook-real-repo.md` :
   - Comment créer une app via UI en pointant sur `MakFly/ploydok-hello`.
   - Comment exposer le webhook (cloudflared free) si l'environnement dev n'est pas public.
   - Comment vérifier signature reçue (`curl -X POST /github/webhook` avec bon HMAC).
4. Corriger les gaps détectés pendant le run : pour chaque échec → 1 commit `fix(webhook-e2e): <cause>`.

**Non-goals** : pas de CI GitHub Actions sur ce test (dépend de l'App de prod). Test local only, reproductible.

---

## 5. Ordre d'exécution consolidé

```
Wave 0 (Sprint 3 closure R1–R6) ─── merge ───┐
                                              │
Wave 1 (Postgres + Redis + BullMQ)  ────── merge ──┐
                                                    │
Wave 2 (2.A + 2.B + 2.C + 2.D en parallèle) ─ merge ─┐
                                                      │
Wave 3 (Webhook E2E sur MakFly/ploydok-hello) ────────┘
```

**Durées estimées** (isolé) :
- Wave 0 : 4–8 h (déjà chiffré dans PLAN-sprint-3-closure.md).
- Wave 1 : 8–12 h (drizzle schema + BullMQ + migration script + tests).
- Wave 2.A : 2 h. 2.B : 4–6 h. 2.C : 3–4 h. 2.D : 4–6 h. En parallèle ≈ 6 h.
- Wave 3 : 1–2 h si Wave 0 verte.

**Total ciblé** : 20–30 h d'implémentation.

---

## 6. Definition of Done consolidée

### Sprint 3 closure
- [ ] R1 à R6 cochés (voir `PLAN-sprint-3-closure.md` §Definition of Done global).

### Postgres + Redis (Wave 1)
- [ ] `make infra-up` démarre postgres + redis + caddy + buildkitd + registry. `docker ps` montre les 5 services healthy.
- [ ] `DATABASE_URL=postgres://...` : tests Drizzle verts.
- [ ] `REDIS_URL=redis://...` : BullMQ consume `deploy.requested` et marque le job `done`.
- [ ] `scripts/migrate-sqlite-to-pg.ts --apply` : diff row counts = 0 entre `ploydok.db` et Postgres.
- [ ] Plus aucun import de `drizzle-orm/sqlite-core` dans `apps/api` ni `packages/db/src/schema/` sauf marqueur historique clair.
- [ ] `bun run typecheck && bun run lint && bun test && bun run check:spdx` verts.

### Sprint 3bis réduit (Wave 2)
- [ ] Interface `GitProvider` + 2 implémentations (GitHub + GitLab).
- [ ] OAuth GitLab fonctionnel sur gitlab.com + 1 instance self-hosted testée.
- [ ] Webhook GitLab vérifié (signature token).
- [ ] Deploy d'un repo GitLab (public + privé) → container live + accessible Caddy.
- [ ] `POST /apps { source: { type: 'image', image: 'nginx:alpine' } }` → container live sans clone/build.
- [ ] Registry credentials : push image privée test OK.
- [ ] `docker inspect <container>` affiche `HostConfig.Memory`, `NanoCpus`, `PidsLimit` conformes au plan.
- [ ] Test OOM : container plan `nano` qui alloue 512 MB → killed par cgroup, instance stable.
- [ ] `docker network inspect ploydok-proj-<projectA>` : contient uniquement les containers du projet A.
- [ ] Test pentest : `exec` dans app projet A → `curl app-du-projet-B` timeout.

### Webhook auto-deploy (Wave 3)
- [ ] `scripts/test-webhook-e2e.sh APP_ID=<id>` : exit 0 en < 180 s.
- [ ] Nouveau commit sur `MakFly/ploydok-hello` → nouveau build `succeeded` < 90 s après push.
- [ ] Domaine de l'app renvoie 200 avec le nouveau contenu.
- [ ] Spec Playwright `github-autodeploy.spec.ts` verte.

---

## 7. Risques & mitigations

| Risque | Mitigation |
|---|---|
| Migration Drizzle SQLite→PG casse du code métier implicitement (types date/int) | Diff sémantique ligne à ligne pendant le refacto + tests unitaires DB dédiés (voir Wave 1.5). |
| BullMQ Redis down = worker ne consomme plus | Healthcheck Redis + alerte + fallback "dev only" sur queue SQLite en read-only (pour debug). |
| GitLab API rate-limit sur self-hosted old version | Pin min GitLab 15.0. Documenté runbook. |
| Test webhook E2E échoue à cause du tunnel public | Runbook fournit 2 méthodes (cloudflared + webhook.site proxy manuel). |
| Quotas trop serrés cassent apps existantes | Backfill plan `custom` sans limite pour apps pré-existantes. Migration idempotente. |
| Network isolation casse les apps déjà déployées | Helper `ensureProjectNetwork` rétro-compatible : attache `ploydok-ingress` en plus, apps existantes reçoivent le nouveau réseau au prochain redeploy. |
| Secrets Postgres/Redis en clair dans env.local | `apps/api/.env.local` gitignoré. Prod : passer par keyring OS (reprendre pattern `keyring.ts`). |

---

## 8. Checklist pré-lancement

- [ ] Worktree propre (aucun `M` pendant restant).
- [ ] `make dev` + `make dev-agent` + `make infra-up` disponibles côté user.
- [ ] Ports libres : 4000, 5173, 5432, 6379, 8180, 8543, 2020, 5000.
- [ ] Repo de test accessible : `MakFly/ploydok-hello` ou `MakFly/fixture-nextjs`.
- [ ] Au moins 1 GitHub App installée sur `MakFly` (vérifier `/settings/github`).
- [ ] Tunnel public disponible si on veut déclencher le webhook depuis github.com.
- [ ] Plan closure Sprint 3 (R1–R6) mergé **avant** de commencer Wave 1 de ce plan.

---

## 9. Non-couvert (volontairement)

- **Gitea** — retiré du scope par décision user.
- **Sprint 4** (secrets chiffrés scopés, domaines wildcard DNS-01, DB templates, rotation orchestrée, backups S3/age, deploy hooks, auto-deploy généralisé multi-provider) — sprint dédié suivant.
- **Sprint 5** (Copilot read-only) — sprint dédié suivant.
- **Prod hardening** (mTLS agent, PKI, audit trail immuable, backup postgres vers S3) — Sprint 6.
- **Orchestration multi-host / Swarm / K8s** — out of scope MVP.
