# Sprint 7 — Parité déploiement (CDN · Previews · Static · Cron · Volumes · Volume backups) ⏳ À faire

**Durée estimée** : 2 semaines (6 mini-features découplables en 2 vagues).
**Objectif** : combler les écarts de parité avec Dokploy/Coolify côté déploiement d'applications, sur la base de l'audit `docs/audits/2026-04-24_20h21_gap-dokploy-sidebar.md` + vérification code.
**Dépendances** : Sprint 4 (domaines, secrets) terminé. Indépendant du Sprint 5 (copilot) et du Sprint 6 (hardening).

---

## Correctifs à l'audit initial (vérification code-in-hand)

| Feature                | État audit           | Réalité code                                                                                                        | Ref                                                                                                            |
| ---------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| MariaDB                | "manque"             | **Déjà supporté** (enum + template MariaDB 11.4)                                                                    | `packages/db/src/schema/databases.ts:16` · `apps/api/src/databases/templates/index.ts:21-116`                  |
| DB backups S3          | "local seul"         | **S3 déjà complet** (age + retention + cron)                                                                        | `packages/db/src/schema/backup_configs.ts` · `apps/api/src/databases/backup.ts` · `apps/api/src/storage/s3.ts` |
| Module S3              | "manque"             | **Déjà présent** : AWS SDK + endpoint custom → compatible AWS / Cloudflare R2 / Scaleway / OVH / Backblaze / Wasabi | `apps/api/src/storage/s3.ts:1-109`                                                                             |
| BullMQ crons           | "stuck-build reaper" | **7 crons infra actifs**                                                                                            | `apps/api/src/worker/index.ts:188-194`                                                                         |
| `build_method=compose` | "supporté"           | **Enum présent, worker throw `FatalDeployError`**                                                                   | `apps/api/src/worker/handlers/deploy.ts:249-251`                                                               |

→ **MariaDB = rien à faire.** Juste une vérif UI (formulaire création DB dans `apps/web/src/routes/_authed/.../databases`) pour s'assurer que le type est sélectionnable. Pas scopé dans ce sprint.

## Ce qui manque réellement

1. **CDN** (cache / compression / headers / image-optim) — Caddy = reverse-proxy + TLS + rate-limit aujourd'hui.
2. **Preview deployments PR** — webhook case existe mais no-op (`apps/api/src/github/webhook.ts:401-404`).
3. **Static sites** — pas de builder static, zéro match `"static"` dans `apps/api/src/worker/`.
4. **Scheduled tasks utilisateur** — zéro schéma, zéro worker.
5. **App persistent volumes** — schema `apps` n'a aucune colonne volume (seules les DB en ont).
6. **Volume backups** — backups = dump DB only (pas tar+encrypt des volumes).

## Ordre suggéré d'exécution

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Vague 1                                                                   │
│   Mini-feature 1 : CDN                 (Caddy-side, pas de schema)        │
│   Mini-feature 3 : Static sites        (étend build pipeline)             │
│   Mini-feature 2 : Preview deployments (réutilise static + domaines)      │
│ Vague 2                                                                   │
│   Mini-feature 4 : Scheduled tasks     (indépendant)                      │
│   Mini-feature 5 : App volumes         (préalable backups volumes)        │
│   Mini-feature 6 : Volume backups      (bloqué par 5)                     │
└──────────────────────────────────────────────────────────────────────────┘
```

Rationale : CDN livrable rapide (pur Caddy). Static sites débloquent preview (90% des previews = static). Volumes avant volume backups (dépendance dure).

---

## Scoping org du monitoring

**Rationale** : Le monitoring aujourd'hui est soit global admin (`/monitoring` platform-wide) soit par hôte (`/docker` container management). Pour atteindre la parité Dokploy, il faut un monitoring **per-org** (`/orgs/$slug/monitoring`) qui agrège les métriques et actions **scoped à l'organisation**. `/docker` est un strict doublon de `/monitoring` hôte et sera supprimé. `/monitoring` global reste comme vue admin (Sprint 6 align).

**Schéma** : pas de changement — utiliser les relations existantes `apps.org_id` et filtrer côté API/UI.

**Backend** :

- `apps/api/src/routes/monitoring.ts` : ajouter `GET /organizations/:slug/monitoring/overview` (filtre containers par org_id).
- `apps/api/src/routes/monitoring.ts` : ajouter `GET /organizations/:slug/monitoring/fleet/quotas` (filtre apps par org_id).
- `apps/api/src/routes/monitoring.ts` : ajouter `POST /organizations/:slug/monitoring/ping/:id` (gate org membership).
- Supprimer `apps/api/src/routes/docker.ts` (doublon strict de `/monitoring` hôte).

**Frontend** :

- `apps/web/src/routes/_authed/orgs/$orgSlug/monitoring.tsx` (nouveau) : dashboard org-scoped, réutilise composants existants.
- Ajouter lien "Monitoring" dans la sidebar org (section Workspace → Monitoring).
- Retirer la route `/docker` du routeur.

**DoD** :

- [ ] Endpoint `GET /organizations/:slug/monitoring/overview` filtre containers par org_id
- [ ] Endpoint `GET /organizations/:slug/monitoring/fleet/quotas` filtre apps par org_id
- [ ] Endpoint `POST /organizations/:slug/monitoring/ping/:id` gate org membership
- [ ] Route TanStack `/orgs/$orgSlug/monitoring` rendue dans la sidebar org
- [ ] Route `/docker` supprimée (doublon strict de /monitoring host)
- [ ] `/monitoring` global conservé comme vue admin platform (Sprint 6 align)

---

## Mini-feature 1 — CDN

**Stratégie** : flag app-level `cdn_mode = "off" | "internal" | "external"`. `internal` active cache-handler + brotli/gzip + headers + image optim dans Caddy. `external` désactive cache/encode internes (évite double-layer) et persiste seulement les headers pour un edge externe (Cloudflare/Bunny). `off` = comportement actuel.

**Schéma** — `packages/db/src/schema/apps.ts` :

```ts
cdn_mode: text("cdn_mode", { enum: ["off", "internal", "external"] }).notNull().default("off"),
cdn_cache_ttl_s: integer("cdn_cache_ttl_s").default(300),
cdn_cache_paths: text("cdn_cache_paths").array(),
cdn_compression: boolean("cdn_compression").notNull().default(false),
cdn_image_optim: boolean("cdn_image_optim").notNull().default(false),
cdn_headers: text("cdn_headers"),                         // JSON {[name]: value}
cdn_external_provider: text("cdn_external_provider"),     // "cloudflare" | "bunny" | null
```

**Caddy** — `apps/api/src/caddy/` :

- `types.ts` : ajouter `cache`, `encode`, `image_optim` handlers.
- `reconciler.ts` : `applyCdnHandlers(app, subroute)` avant `reverse_proxy`. `internal` → cache + encode + headers + image_optim. `external` → seulement headers.
- `client.ts` : patch idempotent (copier le pattern `protection_rate_limit_rps`).

**Plugins Caddy** — `infra/caddy/Dockerfile` (nouveau) : build xcaddy avec `caddy-cache-handler`, `caddy-brotli`, un module image-optim. `infra/docker-compose.yml` → `build: ./caddy` au lieu de `image: caddy:2`. Documenter dans `.claude/rules/infra.md`.

**API** — `apps/api/src/routes/apps-cdn.ts` (nouveau) : `GET /apps/:id/cdn`, `PUT /apps/:id/cdn` (Zod dans `packages/shared/src/schemas/cdn.ts`, TTL 0-86400, header names `/^[A-Za-z-]+$/`). Trigger reconciler après update.

**UI** — `apps/web/src/routes/_authed/apps/$id/settings/cdn.tsx` (nouveau onglet) : toggle mode, slider TTL, éditeur paths, textarea headers JSON, switches compression/image-optim, sélecteur provider si `external`.

**DoD** :

- [ ] Migration + `make db-migrate` OK
- [ ] Toggle `internal` → `curl -I` renvoie `Cache-Status: Caddy; hit` au 2ème hit
- [ ] `Accept-Encoding: br` → `Content-Encoding: br`
- [ ] `GET /img.jpg?w=200` → WebP resizé
- [ ] Toggle `external` → pas de `Cache-Status`, headers persistent
- [ ] Rollback `off` propre
- [ ] Unit test `reconciler.cdn.test.ts` + spec `apps/web/e2e/cdn.spec.ts`

---

## Mini-feature 2 — Preview deployments PR

**Stratégie** : sur PR ouverte/synchronisée → build + deploy éphémère sur `pr-<N>.<app-wildcard>.<base-domain>`. Sur PR fermée → teardown. Table dédiée (pas d'extension `apps`).

**Schéma** :

- Nouvelle table `preview_deployments` (`packages/db/src/schema/preview_deployments.ts`) : `id`, `app_id`, `pr_number`, `head_sha`, `domain`, `container_id`, `status`, `expires_at`, `created_at`.
- `apps` : `preview_enabled bool`, `preview_wildcard text` (ex `preview.example.com`), `preview_ttl_days int default 7`.

**Backend** :

- `apps/api/src/github/webhook.ts:401-404` — remplacer le no-op `pull_request` par dispatch.
- `apps/api/src/webhook-handlers/pull-request.ts` (nouveau, calqué sur `push.ts`) : enqueue `previewDeployQueue` sur `opened`/`synchronize`, `previewTeardownQueue` sur `closed`.
- `apps/api/src/worker/queues.ts` : ajouter les 2 queues.
- `apps/api/src/worker/handlers/preview-deploy.ts` + `preview-teardown.ts` : build `<app>:pr-<N>-<sha>`, spawn container isolé, register domain éphémère Caddy.
- `apps/api/src/worker/jobs/cleanup-previews.ts` (cron) : TTL expiry.
- Commit status GitHub via `apps/api/src/github/app.ts` avec URL preview.

**UI** — `apps/web/src/routes/_authed/apps/$id/previews.tsx` : liste PR, liens, logs, teardown manuel.

**Dépendances** : GitHub App manifest doit souscrire aux events `pull_request` (vérifier). Build pipeline réutilise `buildImage` / `nixpacksBuild` / `railpackBuild`. **Idéalement livré après la mini-feature 3 (static sites)** — majorité des previews = sites statiques.

**DoD** :

- [ ] PR ouverte → row `preview_deployments` created, build lancé
- [ ] `pr-42.<wildcard>` sert le SHA de la PR
- [ ] Push sur la PR → redeploy même domain, nouveau SHA
- [ ] PR closed → teardown en < 60s
- [ ] Commit status GitHub posté avec URL preview
- [ ] TTL expiry teardown auto
- [ ] Spec `apps/web/e2e/preview-pr.spec.ts`

---

## Mini-feature 3 — Static sites

**Stratégie** : nouveau `build_method = "static"`. Build → extraire `dist/` → servir via Caddy `file_server` (zéro runtime container).

**Schéma** — `packages/db/src/schema/apps.ts` :

- Ajouter `"static"` à l'enum `build_method` (ligne 70).
- `static_output_dir text default "dist"`.
- `static_spa_fallback boolean default true`.
- Ajouter `"serving"` à l'enum `apps.status` (distinct de `"running"`).

**Backend** :

- `apps/api/src/worker/handlers/build-static.ts` (nouveau) : run `install_command` + `build_command` (contexte nixpacks), tar `static_output_dir`, écrire dans `/var/lib/ploydok/static/<app_id>/<sha>/` monté RO dans le container Caddy.
- `apps/api/src/worker/handlers/deploy.ts` : branche `"static"` avant `"docker"`. Pas de container, juste un symlink atomique `current → sha/` + reload Caddy.
- `apps/api/src/caddy/reconciler.ts` : handler `file_server` + `try_files` (fallback `/index.html` si `static_spa_fallback`).
- GC : réutiliser la logique `keep_per_repo` d'`apps/api/src/worker/registry.ts` pour purger les vieux SHAs.

**UI** — `apps/web/src/components/apps/build-settings.tsx` : si `build_method=static`, afficher `static_output_dir` + toggle SPA, masquer `runtime_port` / healthcheck.

**DoD** :

- [ ] Vite/Astro/Next static buildée → `dist/` servie
- [ ] Fallback `index.html` si `static_spa_fallback=true`
- [ ] Rollback N-1 via symlink en < 1s
- [ ] GC : 5 deploys avec `keep_per_repo=3` → 3 dossiers SHA restants
- [ ] Cache-Control de base compose avec mini-feature 1
- [ ] Spec `apps/web/e2e/static-site.spec.ts`

---

## Mini-feature 4 — Scheduled tasks utilisateur

**Stratégie** : l'utilisateur définit des tâches (commande + cron) exécutées dans un container one-shot (image de l'app) OU via `docker exec` sur le container de l'app. Logs consultables.

**Schéma** :

- `packages/db/src/schema/scheduled_tasks.ts` : `id`, `app_id`, `name`, `cron`, `command`, `timeout_s`, `enabled`, `last_run_at`, `last_status`, `last_exit_code`.
- Table `scheduled_task_runs` : `id`, `task_id`, `started_at`, `finished_at`, `status`, `exit_code`, `log_blob_ref`.

**Backend** :

- `apps/api/src/worker/jobs/scheduled-tasks-tick.ts` : tick à la minute, sélectionne les tasks dues.
- **Upgrade parser cron** : le parser actuel dans `apps/api/src/databases/backup.ts:55-119` est minimaliste (`0 H * * *` uniquement). Migrer vers la lib `cron-parser` et faire cohabiter backups + scheduled tasks.
- `apps/api/src/worker/handlers/scheduled-task-run.ts` : spawn container one-shot ou `docker exec`, capture stdout/stderr, timeout strict.
- Logs : réutiliser l'infra existante (`apps/api/src/routes/ws.ts` + logs builds).
- `apps/api/src/routes/scheduled-tasks.ts` : CRUD + `POST /apps/:id/scheduled-tasks/:taskId/run` (trigger manuel) + `GET .../runs`.

**UI** — `apps/web/src/routes/_authed/apps/$id/scheduled-tasks.tsx`.

**DoD** :

- [ ] Task `* * * * *` → 2 runs dans 2 minutes
- [ ] Logs consultables dans l'UI
- [ ] `timeout_s` kille le container au-delà
- [ ] Trigger manuel immédiat
- [ ] `enabled=false` → skip
- [ ] Spec `apps/web/e2e/scheduled-tasks.spec.ts`

---

## Mini-feature 5 — App persistent volumes

**Stratégie** : une app déclare N volumes persistants (host path bind mount), normalisés dans une table dédiée. Préalable à la mini-feature 6.

**Schéma** — `packages/db/src/schema/app_volumes.ts` : `id`, `app_id`, `name`, `mount_path`, `size_limit_bytes nullable`, `created_at`. Cascade delete app → volumes.

**Backend** :

- Agent Rust : étendre le proto spawn pour accepter `volumes: [{host_path, container_path}]`. Calquer sur `apps/api/src/databases/spawner.ts:660`.
- Convention host path : `/var/lib/ploydok/app-volumes/<app_id>/<volume_id>/`. Créé au deploy si absent.
- `apps/api/src/worker/handlers/deploy.ts` : passer les volumes à l'agent.
- Lifecycle app delete → purge dossier host (confirmation UI forte, TOTP recommandé).
- `apps/api/src/routes/apps.ts` : CRUD volumes.

**UI** — `apps/web/src/routes/_authed/apps/$id/settings/volumes.tsx`.

**DoD** :

- [ ] App avec volume `data → /data` → fichier persiste après redeploy
- [ ] Delete app → dossier host purgé
- [ ] Size limit check via `du` tick (xfs quota plus tard)
- [ ] Spec `apps/web/e2e/app-volume-persists.spec.ts`

---

## Mini-feature 6 — Volume backups

**Stratégie** : réutiliser ~90% du code `apps/api/src/databases/backup.ts`. Généraliser pour cibler DB **ou** `app_volume`. Archive tar + chiffrement age + destination S3/local + retention + cron.

**Schéma** (2 options, préférer **B**) :

- **A** : étendre `backup_configs` / `backups` avec `target_kind enum ["database","app_volume"]` + `target_id`. FK polymorphe = pas propre en SQL.
- **B (recommandé)** : nouvelle paire `volume_backup_configs` + `volume_backups`, `UNION` dans le cron tick. Meilleure intégrité référentielle.

**Backend** :

- Agent Rust : RPC `tarVolume(host_path, age_recipient) → stream` symétrique de `dumpDatabase`.
- Refactor `apps/api/src/databases/backup.ts` → `apps/api/src/backups/run.ts` qui switch sur `target_kind`.
- Restore RPC `untarVolume(host_path, age_identity)` — refuser si app running (state check).
- `apps/api/src/routes/backups.ts` : généraliser les routes existantes.

**UI** — onglet `apps/web/src/routes/_authed/apps/$id/settings/backups.tsx` partagé DB + volumes.

**DoD** :

- [ ] Backup app volume → archive `.tar.age` dans S3/local
- [ ] Restore (app stoppée) → fichiers reviennent
- [ ] Retention purge vieux backups
- [ ] **Régression** : DB backups existants inchangés, spec e2e passe
- [ ] Concurrent : backup pendant écriture → exit 0 (ou warning doc)
- [ ] Spec `apps/web/e2e/volume-backup.spec.ts`

---

## Stratégie S3 (backups)

Le module `apps/api/src/storage/s3.ts` utilise `@aws-sdk/client-s3` avec endpoint custom + `forcePathStyle` → parle à **tout backend S3 v4** :

- **AWS S3**
- **Cloudflare R2** (endpoint `https://<accountid>.r2.cloudflarestorage.com`, `region=auto`). **Oui, compatible S3 v4** côté API (mêmes verbes : PutObject, GetObject, Multipart…). Limitations mineures (pas d'ACL, consistency) non utilisées dans le code.
- **Scaleway Object Storage** (`https://s3.<region>.scw.cloud`, ex. `fr-par`)
- **OVH Cloud Object Storage** (`https://s3.<region>.cloud.ovh.net`)
- **Backblaze B2** (`https://s3.<region>.backblazeb2.com`)
- **Wasabi** (`https://s3.<region>.wasabisys.com`)

Côté schéma : pas de changement (`s3_endpoint`, `s3_bucket`, `s3_prefix`, `s3_region`, `s3_credentials_secret_id` déjà là).
Côté UI : ajouter un preset "Provider" (AWS / R2 / Scaleway / OVH / Backblaze / Wasabi / Custom) qui pré-remplit endpoint + region, avec champ "Custom" libre.

**Pas de MinIO** (évité). Pour les tests locaux : **Garage** (serveur Rust S3-compatible, léger, actif) ou **s3mock** (Adobe, JVM, zero-config). En CI, possibilité d'activer un compte R2 de test via env `PLOYDOK_TEST_R2_*`.

---

# Jeu de tests — harnais de validation

Tout passe par **UI + API + CLI réels** (pas de mocks) sur l'infra locale `make infra-up` + `make dev` + `make dev-agent`. Chaque feature a ses fixtures, scénarios manuels et spec Playwright.

## Fixtures partagées

À créer dans `apps/web/e2e/fixtures/` :

| Fixture                     | Description                                                                                                | Chemin                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `repos/static-vite/`        | Vite minimal (index.html + 1 component), `bun run build` → `dist/`. Static + preview.                      | `apps/web/e2e/fixtures/repos/static-vite`        |
| `repos/node-hono/`          | Serveur Hono `{ ok:true, version: process.env.APP_VERSION }`. Dockerfile minimal. Runtime + preview + CDN. | `apps/web/e2e/fixtures/repos/node-hono`          |
| `repos/php-laravel-sample/` | Laravel écrivant dans `/data/notes.txt` à chaque hit. Volumes + volume backups.                            | `apps/web/e2e/fixtures/repos/php-laravel-sample` |
| `repos/large-assets/`       | Site static 50 Mo (images + gros JS). Cache-hit CDN + brotli + image-optim.                                | `apps/web/e2e/fixtures/repos/large-assets`       |
| `helpers/git-serve.ts`      | Pousse un dossier fixture sur un Gitea local et renvoie l'URL clone.                                       | `apps/web/e2e/fixtures/helpers/git-serve.ts`     |
| `helpers/pr-simulator.ts`   | Émet un payload webhook `pull_request` signé HMAC vers l'API (simule GitHub).                              | `apps/web/e2e/fixtures/helpers/pr-simulator.ts`  |
| `helpers/s3-local.ts`       | Bootstrap d'un backend S3-compatible (Garage) + bucket + creds. API AWS S3 v4.                             | `apps/web/e2e/fixtures/helpers/s3-local.ts`      |

## Stack de test — `infra/docker-compose.test.yml` (nouveau)

```yml
services:
  s3-test:
    image: dxflrs/garage:v1.0.1
    ports: ["3900:3900", "3901:3901", "3902:3902"]
    volumes:
      - ./infra/garage/garage.toml:/etc/garage.toml:ro
      - s3-test-data:/var/lib/garage
  gitea-test:
    image: gitea/gitea:1
    ports: ["3000:3000", "2222:22"]
volumes:
  s3-test-data:
```

`infra/garage/garage.toml` (creds test non sensibles, versionnées) :

```toml
metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "0000000000000000000000000000000000000000000000000000000000000000"
[s3_api]
s3_region = "garage"
api_bind_addr = "[::]:3900"
root_domain = ".s3.garage.localhost"
[s3_web]
bind_addr = "[::]:3902"
root_domain = ".web.garage.localhost"
index = "index.html"
```

`helpers/s3-local.ts` : `docker exec s3-test garage layout assign … && bucket create ploydok-test && key create` (idempotent), renvoie `{ endpoint:"http://localhost:3900", region:"garage", accessKeyId, secretAccessKey, bucket:"ploydok-test" }`.

Démarrage : `docker compose -f infra/docker-compose.yml -f infra/docker-compose.test.yml up -d`.

## Jeu 1 — CDN

**Fixtures** : `repos/large-assets/` déployée → app `cdn-test`.

```bash
# 1. Baseline (cdn_mode=off)
curl -I -H "Accept-Encoding: br" https://cdn-test.localtest.me:8543/assets/app.js
# Expect: no Cache-Status, no Content-Encoding

# 2. Switch internal
curl -X PUT https://localhost:3335/apps/$APP_ID/cdn \
  -H "X-CSRF-Token: $CSRF" --cookie "ploydok_access=$JWT" \
  -d '{"cdn_mode":"internal","cdn_cache_ttl_s":600,"cdn_cache_paths":["/assets/*"],"cdn_compression":true,"cdn_image_optim":true,"cdn_headers":{"X-Custom":"ok"}}'

# 3-4. Miss puis Hit
curl -I https://cdn-test.localtest.me:8543/assets/app.js  # Cache-Status: Caddy; miss
curl -I https://cdn-test.localtest.me:8543/assets/app.js  # Cache-Status: Caddy; hit

# 5. Brotli
curl -I -H "Accept-Encoding: br" https://cdn-test.localtest.me:8543/assets/app.js
# Expect: Content-Encoding: br

# 6. Image optim
curl -o /tmp/resized.webp "https://cdn-test.localtest.me:8543/hero.jpg?w=200"
file /tmp/resized.webp  # Expect WebP, width 200

# 7. Header custom
curl -I https://cdn-test.localtest.me:8543/  # Expect: X-Custom: ok

# 8. Switch external → pas de cache, headers persistent
curl -X PUT .../cdn -d '{"cdn_mode":"external","cdn_headers":{"X-Custom":"ok"}}'
curl -I https://cdn-test.localtest.me:8543/assets/app.js
```

Spec : `apps/web/e2e/cdn.spec.ts` + unit `apps/api/src/caddy/reconciler.cdn.test.ts`.

## Jeu 2 — Preview deployments

**Fixtures** : `repos/node-hono/` dans Gitea-test (ou repo GitHub réel via `PLOYDOK_TEST_REPO`). App `preview-test`, `preview_enabled=true`, `preview_wildcard=preview.localtest.me`.

```bash
# 1. Simuler PR open
bun run apps/web/e2e/fixtures/helpers/pr-simulator.ts open \
  --app $APP_ID --pr 42 --sha abc123 --branch feat/x

# 2. Vérifier le domaine sert la version PR
curl https://pr-42.preview.localtest.me:8543/  # { ok:true, version:"abc123" }

# 3. Push (synchronize)
bun run .../pr-simulator.ts sync --app $APP_ID --pr 42 --sha def456
curl https://pr-42.preview.localtest.me:8543/  # version:"def456"

# 4. Commit status GitHub posté (vérifier via API GitHub ou mock)

# 5. PR closed → teardown < 60s
bun run .../pr-simulator.ts close --app $APP_ID --pr 42
sleep 60; curl -I https://pr-42.preview.localtest.me:8543/  # 404 / refusé

# 6. TTL expiry : forcer expires_at=now-1d et déclencher cron
```

Spec : `apps/web/e2e/preview-pr.spec.ts`.

## Jeu 3 — Static sites

**Fixtures** : `repos/static-vite/` → app `static-test` avec `build_method=static`.

```bash
# 1. Push → build → serving
curl https://static-test.localtest.me:8543/        # 200, HTML
curl https://static-test.localtest.me:8543/assets/*.js  # 200

# 2. SPA fallback
curl https://static-test.localtest.me:8543/some/client/route  # index.html

# 3. Rollback via UI → ancien SHA en < 1s (atomicité symlink)

# 4. GC : 5 deploys avec keep_per_repo=3
ls /var/lib/ploydok/static/$APP_ID/ | wc -l  # 3

# 5. Compose avec CDN (jeu 1) : cache + image optim
```

Spec : `apps/web/e2e/static-site.spec.ts`.

## Jeu 4 — Scheduled tasks

**Fixtures** : app `scheduled-test` (node-hono) running.

```bash
# 1. Créer task
curl -X POST .../apps/$APP_ID/scheduled-tasks \
  -d '{"name":"cleanup","cron":"* * * * *","command":"echo hello","timeout_s":10}'

# 2. Attendre 2 min → 2 runs
sleep 130
curl .../apps/$APP_ID/scheduled-tasks/$TASK_ID/runs
# Expect: 2 runs, status=succeeded, log contient "hello"

# 3. Manual trigger
curl -X POST .../apps/$APP_ID/scheduled-tasks/$TASK_ID/run

# 4. Timeout : command="sleep 30", timeout_s=5
# Expect run status=failed, exit_code=137 (SIGKILL)

# 5. Disable → skip au prochain tick
```

Spec : `apps/web/e2e/scheduled-tasks.spec.ts`.

## Jeu 5 — App persistent volumes

**Fixtures** : `repos/php-laravel-sample/` → app `vol-test` avec volume `data → /data`.

```bash
# 1-2. 3 hits → 3 lignes /data/notes.txt
for i in 1 2 3; do curl https://vol-test.localtest.me:8543/hit; done
cat /var/lib/ploydok/app-volumes/$APP_ID/$VOLUME_ID/notes.txt  # 3 lignes

# 3. Redeploy → data persiste
curl https://vol-test.localtest.me:8543/hit
wc -l /var/lib/ploydok/app-volumes/$APP_ID/$VOLUME_ID/notes.txt  # 4

# 4. Delete app → purge
ls /var/lib/ploydok/app-volumes/$APP_ID/ 2>&1  # No such file
```

Spec : `apps/web/e2e/app-volume-persists.spec.ts`.

## Jeu 6 — Volume backups

**Fixtures** : reprendre `vol-test` avec données. Backend S3 local (Garage) via `helpers/s3-local.ts`. Clé age : `age-keygen > /tmp/age.key`.
**Matrice providers** : `garage` (défaut local), `r2` (si `PLOYDOK_TEST_R2_*`), optionnel `scaleway`/`aws` en CI nightly.

```bash
# 1. Config backup S3 (Garage local)
curl -X PUT .../apps/$APP_ID/volumes/$VOLUME_ID/backup-config \
  -d '{"destination_kind":"s3","s3_endpoint":"http://localhost:3900","s3_bucket":"ploydok-test","s3_prefix":"vol/","s3_region":"garage","s3_credentials_secret_id":"$SECRET_ID","schedule_cron":"0 3 * * *","retention_days":7,"age_recipient_public_key":"$PUB_KEY","enabled":true}'

# Variante R2
# -d '{..., "s3_endpoint":"https://<acc>.r2.cloudflarestorage.com", "s3_region":"auto", ...}'

# 2. Backup manuel
curl -X POST .../apps/$APP_ID/volumes/$VOLUME_ID/backup-now
aws --endpoint-url http://localhost:3900 s3 ls s3://ploydok-test/vol/  # 1 .tar.age

# 3. Corrompre les données locales
rm -rf /var/lib/ploydok/app-volumes/$APP_ID/$VOLUME_ID/*

# 4. Restore (app stoppée)
curl -X POST .../apps/$APP_ID/stop
curl -X POST .../backups/$BACKUP_ID/restore \
  -H "X-TOTP: $TOTP" -d '{"age_identity":"'$(cat /tmp/age.key)'"}'
ls /var/lib/ploydok/app-volumes/$APP_ID/$VOLUME_ID/  # notes.txt restauré

# 5. Retention : 10 backups, retention_days=3 → 3 restent
# 6. Régression : spec database-backup.spec.ts passe
# 7. Concurrent : backup pendant écriture → exit 0 + cohérence (ou warning doc)
```

Spec : `apps/web/e2e/volume-backup.spec.ts`.

## Matrice de tests

| Axe                        | CDN | Preview | Static | Sched | Volumes | VolBackup |
| -------------------------- | :-: | :-----: | :----: | :---: | :-----: | :-------: |
| Migration `db-migrate` OK  |  ✓  |    ✓    |   ✓    |   ✓   |    ✓    |     ✓     |
| API route (CRUD)           |  ✓  |    ✓    |   —    |   ✓   |    ✓    |     ✓     |
| Caddy reconciler OK        |  ✓  |    ✓    |   ✓    |   —   |    —    |     —     |
| Worker handler             |  —  |    ✓    |   ✓    |   ✓   |    —    |     ✓     |
| Agent Rust RPC             |  —  |    —    |   —    |   ✓   |    ✓    |     ✓     |
| Cron récurrent             |  —  |    ✓    |   —    |   ✓   |    —    |     ✓     |
| Rollback / teardown propre |  ✓  |    ✓    |   ✓    |   ✓   |    ✓    |     ✓     |
| UI écran dédié             |  ✓  |    ✓    |   ✓    |   ✓   |    ✓    |     ✓     |
| Regression suite existante |  ✓  |    ✓    |   ✓    |   ✓   |    ✓    |     ✓     |

## Cleanup post-tests (obligatoire)

```bash
docker ps -a --filter "name=ploydok-app-e2e-" --filter "name=ploydok-app-iso-" -q | xargs -r docker rm -f
sudo rm -rf /var/lib/ploydok/app-volumes/e2e-*
sudo rm -rf /var/lib/ploydok/static/e2e-*
aws --endpoint-url http://localhost:3900 s3 rb s3://ploydok-test --force 2>/dev/null || true
docker compose -f infra/docker-compose.test.yml down -v
```

## Ordre recommandé d'exécution pendant le dev

1. Implem feature → unit tests (`bun test`) verts.
2. `bun run typecheck && bun run lint && bun run check:spdx` verts.
3. `make infra-up` + `make dev` + `make dev-agent` tournants.
4. Scénarios curl/docker du jeu concerné.
5. Spec Playwright du jeu.
6. Cleanup.
7. Suite e2e complète (étendre `make dod`) — aucune régression.

---

## Non-couvert (hors scope, à porter sur un autre sprint)

- **Marketplace de services 1-click** (parité 354 templates Coolify).
- **Multi-serveur / clusters** (Dokploy clusters, Coolify Swarm).
- **Bitbucket + Gitea + upload ZIP** comme sources git.
- **Buildpacks Heroku / Paketo** (builder addition).
- **CDN edge externe automatisé** : sync des règles CDN vers Cloudflare/Bunny via API (la feature 1 persiste seulement les headers en mode `external`).
- Migration de `backup-databases.ts` vers un **parser cron complet** (lib `cron-parser`) — à initier dans la mini-feature 4 (scheduled tasks), mais la généralisation totale peut déborder.
