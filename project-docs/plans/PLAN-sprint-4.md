# PLAN — Sprint 4 : Secrets, domaines, DB one-click

> ✅ Terminé 2026-04-22

> Plan d'implémentation détaillé pour `project-docs/roadmap/sprint-4-secrets-domaines-db.md`.
> Écrit 2026-04-22 après clôture du sprint 3.1.1.
> Objectif : livrer l'autonomie complète pour déployer une app de prod réelle (env scopées, wildcard TLS, DB managées, protection apps, backups).
>
> **Durée estimée : ~10-12 j ouvrés** (spec annonce 1 sem. — recalibré audit 2026-04-22).
> **Livraison one-shot** (pas de split a/b), Waves 1→7 séquentielles avec parallélisme intra-wave.
> **Hors-scope délibéré** : PR preview envs (reporté sprint 3.1.2), multi-node/Swarm (v1.5), templates marketplace (v1.5).

---

## Context

Après le sprint 3.1.1 (webhook auto-deploy + notifications), l'audit Dokploy/Coolify du 22/04 a identifié **5 gaps critiques**. Ce sprint attaque 3 d'entre eux (DB one-click, wildcard TLS, volumes persistants) plus la couche **secrets** indispensable à toute app de prod réelle.

Les briques déjà en place (à **réutiliser**, pas recréer) :
- **Secrets** : table `secrets` (`packages/db/src/schema/secrets.ts`) avec enum scope `shared/prod/preview/dev`, `encryptField/decryptField` (AES-GCM via master key keyring), `apps/api/src/keyring.ts`
- **Domains** : table `domains` (hostname + tls_status), `apps/api/src/routes/apps-domains.ts`
- **Caddy** : `apps/api/src/caddy/client.ts` avec `upsertRoute`/`removeRoute` + TLS auto HTTP-01
- **Agent Rust** : spawn container + volumes (service.rs:149,360), mTLS en prod, unix socket `/tmp/ploydok-agent.sock` en dev
- **Blue-green** : `worker/handlers/deploy.ts` (sprint 3), réutilisable pour rolling redeploy lors de rotation DB
- **Notifications** : dispatcher multi-canaux (sprint 3.1.1) → réutiliser pour `db.rotated`, `backup.succeeded`, etc.
- **2FA middleware** : `apps/api/src/auth/second-factor.ts` → `requireSecondFactor` pour reveal/rotate/restore

---

## Architecture cible

```
╔═══════════════════════ Interactions utilisateur ═══════════════════════════════════╗
║                                                                                    ║
║  UI /apps/$id/env ──────┐  UI /apps/$id/domains ──┐  UI /databases ──────┐         ║
║  (scopes + reveal)      │  (DNS-01, protection)   │  (spawn, backup, link)         ║
║                         ▼                         ▼                      ▼         ║
╚═════════════════════════╪═════════════════════════╪══════════════════════╪═════════╝
                          │                         │                      │
                          │ HTTPS + CSRF + TOTP     │                      │
                          ▼                         ▼                      ▼
╔═══════════════════════ API Hono :3335 ═════════════════════════════════════════════╗
║                                                                                    ║
║  routes/secrets.ts     routes/apps-domains.ts     routes/databases.ts              ║
║  ├─ GET scope          ├─ POST hostname           ├─ POST /databases (template)    ║
║  ├─ POST/PATCH encrypt ├─ verify DNS (TXT)        ├─ POST /link app↔db             ║
║  ├─ reveal(TOTP)       ├─ DNS-01 (CF/R53/OVH/DO)  ├─ POST rotate (orchestrated)    ║
║  └─ import .env        └─ upload cert manuel      └─ POST backup/restore           ║
║                                                                                    ║
║  Injection runtime (worker/handlers/deploy.ts)                                     ║
║  buildEnvForDeploy(app, buildKind) :                                               ║
║    kind=production → merge(secrets.scope='shared', secrets.scope='prod')           ║
║    kind=preview    → merge(secrets.scope='shared', secrets.scope='preview')        ║
║    conflict        → scope spécifique gagne sur shared                             ║
║                                                                                    ║
║  Hooks deploy (nouveau) :                                                          ║
║    pre_deploy  → container éphémère (image build) → shell hooks.pre_deploy         ║
║    │            fail → deploy abort, ancien container reste live                   ║
║    run new container blue → healthcheck → Caddy swap ← existant sprint 3           ║
║    post_deploy → container éphémère → shell hooks.post_deploy                      ║
║                 fail → deploy marqué "succeeded-with-warning", notif               ║
║                                                                                    ║
╚═══════════════════════════════════════╤════════════════════════════════════════════╝
                                        │ gRPC unix socket
                                        ▼
╔═══════════════════════ Agent Rust (ploydok-agent) ═════════════════════════════════╗
║                                                                                    ║
║  ContainerCreate / Start / Stop / Remove       VolumeCreate / Remove               ║
║  ├─ allowlist d'images OCI                     ├─ nommé ploydok-db-<id>            ║
║  ├─ cgroups (CPU, RAM, pids)                   ├─ monté dans container DB          ║
║  ├─ network join (ploydok-net-<project_id>)    └─ persiste entre restarts          ║
║  └─ spawn DB container (Postgres / Redis / Mongo) via templates YAML               ║
║                                                                                    ║
║  DumpDatabase (nouveau RPC)                    RestoreDatabase (nouveau RPC)       ║
║  ├─ docker exec <container> pg_dumpall         ├─ exec psql -f <file> dans nouveau ║
║  ├─ stream chunks bytea → API                    container                         ║
║  ├─ API chiffre via age (clé user) + push S3   └─ healthcheck post-restore         ║
║  └─ fallback local /var/lib/ploydok/backups                                        ║
║                                                                                    ║
╚═══════════════════════════════════════╤════════════════════════════════════════════╝
                                        │ docker.sock
                                        ▼
╔═══════════════════════ Runtime Docker (hôte) ══════════════════════════════════════╗
║                                                                                    ║
║  ┌── Apps (existant) ──────────────┐   ┌── Databases (nouveau sprint 4) ────────┐  ║
║  │ app-<id>-blue / -green          │   │ ploydok-db-pg-<id>                     │  ║
║  │ connectés ploydok-net-<proj>    │◀──┤ Postgres 16 + volume ploydok-db-<id>   │  ║
║  │ reçoivent DATABASE_URL via env  │   │ ploydok-db-redis-<id>                  │  ║
║  │ injection                       │   │ Redis 7 + volume                       │  ║
║  └──────────────┬──────────────────┘   │ ploydok-db-mongo-<id>                  │  ║
║                 │                      │ Mongo 7 + volume                       │  ║
║                 │                      │                                        │  ║
║                 │ HTTP/HTTPS           │ NOT exposed publicly — intra-net only  │  ║
║                 ▼                      └────────────────────────────────────────┘  ║
║  ┌── Caddy (sprint 3/3bis + NEW) ──────────────────────────────────────────────┐   ║
║  │                                                                             │   ║
║  │  :443 → domaine.user.com                                                    │   ║
║  │  upsertRoute(host, upstream=<app-blue>, tls=auto)                           │   ║
║  │                                                                             │   ║
║  │  NEW — Middlewares per-app (configurable UI)                                │   ║
║  │  ├─ basicauth (user/pass chiffrés → secrets table, type=basicauth)          │   ║
║  │  ├─ @allowed remote_ip [CIDRs]                                              │   ║
║  │  └─ rate_limit req/s/IP (module Caddy rate_limit)                           │   ║
║  │                                                                             │   ║
║  │  NEW — TLS modes                                                            │   ║
║  │  ├─ HTTP-01 (défaut, existant) — simple, pas de wildcard                    │   ║
║  │  ├─ DNS-01 (nouveau) — wildcard via provider API                            │   ║
║  │  │   ├─ Cloudflare : CF_API_TOKEN secret                                    │   ║
║  │  │   ├─ Route53    : AWS_* secrets                                          │   ║
║  │  │   ├─ OVH        : OVH_* secrets                                          │   ║
║  │  │   └─ DigitalOcean: DO_AUTH_TOKEN                                         │   ║
║  │  └─ Manual cert (nouveau) — upload PEM, désactive ACME pour ce domaine      │   ║
║  │                                                                             │   ║
║  └─────────────────────────────────────────────────────────────────────────────┘   ║
║                                                                                    ║
╚════════════════════════════════════════════════════════════════════════════════════╝
                                    │
                                    │ Backups
                                    ▼
╔═══════════════════════ Storage backups ════════════════════════════════════════════╗
║                                                                                    ║
║  cron scheduler (BullMQ repeat job, 03:00 UTC default)                             ║
║  per DB :                                                                          ║
║    dump → agent.DumpDatabase → stream chunks → chiffrement age (clé user)          ║
║                                                                                    ║
║  ┌─ S3 / R2 / MinIO ─────┐          ┌─ Local fallback ──────────────────────────┐  ║
║  │ credentials in secrets│          │ /var/lib/ploydok/backups/<db_id>/<ts>.age │  ║
║  │ bucket + prefix/db_id │          │ rotation 7 j                              │  ║
║  │ rotation 7 j default  │          └───────────────────────────────────────────┘  ║
║  └──────────────────────┘                                                          ║
║                                                                                    ║
║  Restore flow : download → age decrypt → agent.RestoreDatabase → psql/mongo        ║
║                 → healthcheck auto → notif                                         ║
║                                                                                    ║
╚════════════════════════════════════════════════════════════════════════════════════╝

── Legend ─────────────────────────────────────────────────────────────────────────
  ──▶  Flux synchrone          ═══  Module boundary
  DNS-01 = ACME challenge DNS TXT record (nécessaire pour wildcards *.app.com)
  age    = chiffrement client-side (filippo.io/age) avec clé user, pas serveur
  rolling redeploy = blue/green existant sprint 3, réutilisé pour rotation DB
```

### Composants clés introduits

| Composant | Rôle | Fichier |
|---|---|---|
| `buildEnvForDeploy` | Merge secrets selon scope | nouveau `apps/api/src/secrets/resolver.ts` |
| `DnsVerifier` | Poll DNS TXT `_ploydok-verify.<host>` | nouveau `apps/api/src/domains/verifier.ts` |
| `Dns01Provider` | Interface + impls CF/Route53/OVH/DO | nouveau `apps/api/src/domains/dns01/*.ts` |
| `CaddyMiddlewares` | Render config `basicauth`/`remote_ip`/`rate_limit` | étendre `apps/api/src/caddy/client.ts` |
| `dbTemplates` | YAML Postgres 16, Redis 7, Mongo 7 | nouveau `apps/api/src/databases/templates/*.yml` |
| `dbSpawner` | Appel agent `ContainerCreate` + `VolumeCreate` | nouveau `apps/api/src/databases/spawner.ts` |
| `RotationOrchestrator` | Double-write 5 min + rolling redeploy | nouveau `apps/api/src/databases/rotation.ts` |
| `DumpDatabase`/`RestoreDatabase` | gRPC RPC agent (Rust) | `agent/ploydok-agent/src/service.rs` + proto |
| `BackupScheduler` | BullMQ repeat job (cron) | nouveau `apps/api/src/worker/jobs/backup-databases.ts` |
| `AgeCipher` | Wrapper `age` binary via agent | nouveau `apps/api/src/crypto/age.ts` |

---

## État du code (audit 2026-04-22)

| Sujet | Fichier | État |
|---|---|---|
| Schema `secrets` | `packages/db/src/schema/secrets.ts` | ✅ scope enum présent (shared/prod/preview/dev) |
| Schema `domains` | `packages/db/src/schema/domains.ts` | ✅ + tls_status (pending/issued/failed) |
| `encryptField`/`decryptField` | `apps/api/src/github/app-credentials.ts` et autres | ✅ AES-GCM via master key |
| Caddy client | `apps/api/src/caddy/client.ts` | ✅ upsertRoute/removeRoute — **manque middlewares + DNS-01** |
| Agent RPC | `agent/ploydok-agent/src/service.rs` | ✅ ContainerCreate + VolumeCreate — **manque Dump/Restore** |
| Routes secrets | — | ❌ à créer |
| Routes databases | — | ❌ à créer |
| UI env vars | — | ❌ à créer |
| UI domains | `apps/web/src/routes/_authed/apps/$id/domains.tsx` | ⚠️ basique, pas de DNS-01 ni middlewares |
| UI databases | — | ❌ à créer |
| UI protection | — | ❌ à créer |
| Templates DB YAML | — | ❌ à créer |
| Deploy hooks | — | ❌ à créer |
| Backup scheduler | — | ❌ à créer |
| `age` dependency | — | ❌ à ajouter (binary côté agent) |
| Caddy modules (`rate_limit`, DNS providers) | `infra/caddy/` | ⚠️ binary standard ne les inclut pas → **Dockerfile `xcaddy build` bloquant W4** |

---

## Découpage en Waves

```
Wave 1 (env vars) ──┐
                    ├──▶ Wave 3 (DB + link) ──┐
Wave 2 (domains)  ──┘                         ├──▶ Wave 5 (rotation + hooks) ──▶ Wave 7 (E2E + DoD)
                                              │
                                  Wave 4 (protection + cert manuel) ──┘
                                              │
                                  Wave 6 (backup + restore) ──────────┘
```

- **W1 ∥ W2** (fichiers disjoints : secrets vs domains/caddy).
- **W3 ∥ W4** après W1/W2.
- **W5 ∥ W6** après W3 (les deux dépendent de la table `databases`).
- **W7** séquentiel.

---

### Wave 1 — Env vars chiffrées + scopes + reveal (2 j)

Objectif : `/apps/$id/env` complet avec reveal TOTP, import/export `.env`, injection runtime contextuelle.

- **[//] 1.A — Résolveur runtime `buildEnvForDeploy`**
  - Nouveau `apps/api/src/secrets/resolver.ts` : `buildEnvForDeploy(db, appId, kind: 'prod'|'preview'): Promise<Record<string,string>>`
  - Query `secrets` pour l'app + scope matching. Merge : `shared` → scope spécifique (override).
  - Appelé dans `worker/handlers/deploy.ts` avant `runBlueGreen`.
  - Tests unitaires (conflit shared vs prod, scope preview vs prod, vars vides, clé dupliquée).

- **[//] 1.B — Routes CRUD secrets**
  - Nouveau `apps/api/src/routes/secrets.ts` :
    - `GET /apps/:id/secrets?scope=...` — liste sans valeurs (key+scope+updated_at)
    - `POST /apps/:id/secrets` — create/update, chiffre via `encryptField`
    - `DELETE /apps/:id/secrets/:key?scope=...`
    - `POST /apps/:id/secrets/:key/reveal` — protégé `requireSecondFactor`, retourne plaintext
    - `POST /apps/:id/secrets/import` — multipart `.env` avec `@scope KEY=value` optionnel
    - `GET /apps/:id/secrets/export?scope=...` — export chiffré age (jamais plaintext)
  - Mount dans `app.ts`.

- **[//] 1.C — UI env vars**
  - Refactor `apps/web/src/routes/_authed/apps/$id/env.tsx` avec sub-tabs scope (shared/prod/preview/dev).
  - Composants nouveaux : `SecretsTable`, `AddSecretDialog`, `RevealSecretDialog` (TOTP modal), `ImportEnvDialog`.
  - Badge `linked` RO pour vars générées par link DB (W3).

- **1.D — Audit log**
  - Hook sur chaque mutation → `audit_log action="secret.created/updated/deleted/revealed/imported"` (SHA-256 du key seulement, jamais la valeur).

**Validation W1** : `bun test apps/api/src/secrets/` + typecheck + reveal flow manuel (TOTP).

---

### Wave 2 — Domaines : DNS-01 wildcard + vérification (2 j)

- **[//] 2.A — DNS verification service**
  - Nouveau `apps/api/src/domains/verifier.ts` : poll TXT `_ploydok-verify.<host>` toutes 30 s, max 20 essais.
  - BullMQ : `domainVerifyQueue.add('verify', { domainId }, { attempts: 20, backoff: 30_000 })`.
  - UI : toast live via SSE existant (`/events`).

- **[//] 2.B — Interface `Dns01Provider` + 4 impls**
  - Nouveau `apps/api/src/domains/dns01/types.ts` :
    ```ts
    interface Dns01Provider {
      createTXTRecord(zone, name, value): Promise<{ recordId: string }>
      deleteTXTRecord(zone, recordId): Promise<void>
    }
    ```
  - Impls : `cloudflare.ts`, `route53.ts`, `ovh.ts`, `digitalocean.ts`
  - Credentials stockés en `secrets` (scope `shared`, type `dns01_provider`), chiffrés.

- **[//] 2.C — Caddy DNS-01 integration**
  - Caddy supporte DNS-01 via modules officiels (`caddy-dns/cloudflare` etc.) — nécessite `xcaddy build`.
  - Décision lockée : **passer par Caddy** (pas notre propre ACME client) — token provider pushé dans la config.
  - Étendre `apps/api/src/caddy/client.ts` :
    ```ts
    upsertRoute({ host, upstream, appId, tls: { mode: 'http01' | 'dns01', provider?, token? } })
    ```
  - Route `POST /apps/:id/domains/:domain/tls/mode` → switch HTTP-01 ↔ DNS-01.

- **2.D — UI /apps/$id/domains refactor**
  - Formulaire : hostname + toggle wildcard + select provider si wildcard.
  - Badge `tls_status` + explications user-friendly.
  - Si `failed` : `last_error` + bouton Retry.

---

### Wave 3 — DB one-click + lifecycle + link (2 j)

- **[//] 3.A — Templates YAML + schema DB**
  - Nouveaux `apps/api/src/databases/templates/{postgres,redis,mongo}.yml` :
    ```yaml
    kind: postgres
    image: postgres:16-alpine
    plans:
      small:  { cpu: 0.5, mem: 512Mi }
      medium: { cpu: 1.0, mem: 2Gi }
      large:  { cpu: 2.0, mem: 8Gi }
    volume: /var/lib/postgresql/data
    healthcheck: pg_isready -U $POSTGRES_USER
    env_auto:
      POSTGRES_USER: "ploydok"
      POSTGRES_DB: "app"
      POSTGRES_PASSWORD: "@generated(32)"
    ```
  - Nouveau schema `packages/db/src/schema/databases.ts` :
    `id, project_id, kind, name, plan, container_id, volume_name, connection_string_enc, master_password_enc, password_rotated_at, rotation_schedule, created_at`.

- **[//] 3.B — DbSpawner**
  - Nouveau `apps/api/src/databases/spawner.ts` :
    - Génère password 32 chars (entropy ≥ 128 bits).
    - Appelle agent `VolumeCreate` + `ContainerCreate` (network `ploydok-net-<project>`, no port publish).
    - Build connection string et chiffre.
  - Routes `apps/api/src/routes/databases.ts` :
    - `POST /databases` — { kind, name, plan } → spawn
    - `GET /databases`, `GET /databases/:id`
    - `POST /databases/:id/reveal` — TOTP → connection string
    - `DELETE /databases/:id` — stop + remove volume (challenge texte + TOTP)

- **[//] 3.C — Linking app ↔ DB**
  - Nouveau schema `app_db_links` : `app_id, database_id, env_prefix (default DATABASE), created_at`.
  - Route `POST /apps/:id/databases/:dbId/link` → insère vars `<PREFIX>_URL`, `<PREFIX>_USER`, etc. dans `secrets` scope `shared` avec flag `linked=true`.
  - UI : `/apps/$id/env` bouton "Link database" → dialog sélection.
  - Warning UI si delete DB linked : liste des apps impactées.

- **[//] 3.D — UI /databases**
  - Nouvelle route `/databases` (scope projet) : cards DB (kind icon, plan, linked apps count, status).
  - Bouton `Create database` → dialog kind+name+plan.
  - Détail `/databases/$id` : infos, connection string (masked + reveal), linked apps, actions (Rotate, Backup now, Restore).

**Validation W3** : spawn Postgres UI → link app Next.js → `DATABASE_URL` injectée → connexion réussie.

---

### Wave 4 — Protection Caddy + cert manuel (1.5 j)

- **[//] 4.A — Caddy custom Dockerfile (BLOQUANT — avant 4.B/4.C)**
  - Nouveau `infra/caddy/Dockerfile` avec `xcaddy build` :
    - Module `github.com/mholt/caddy-ratelimit`
    - Modules DNS `github.com/caddy-dns/{cloudflare,route53,ovh,digitalocean}`
  - Maj `infra/docker-compose.yml` : `build: infra/caddy/` au lieu d'`image: caddy:2`.
  - Test `make infra-up && make infra-down` idempotent.

- **[//] 4.B — Middlewares Caddy**
  - Étendre `apps/api/src/caddy/client.ts` : `upsertRoute` accepte `middlewares: { basicAuth?, ipAllowlist?, rateLimit? }`.
  - Render handler array Caddy (`authentication`, `subroute` avec `remote_ip` matcher, `rate_limit`).

- **[//] 4.C — Schema + routes protection**
  - Étendre `apps` : `protection_basic_auth_enabled bool`, `protection_ip_allowlist text[]`, `protection_rate_limit_rps integer nullable`.
  - Secrets `basic_auth_user`, `basic_auth_pass` chiffrés (type=`basicauth`).
  - Route `POST /apps/:id/protection` → update + re-push Caddy config.
  - UI `/apps/$id/protection` : 3 toggles + forms conditionnels.

- **[//] 4.D — Import cert manuel**
  - Nouveau schema `tls_certificates` : `id, app_id, domain, cert_enc, key_enc, not_before, not_after, created_at`.
  - Route `POST /apps/:id/domains/:domain/tls/upload` multipart → parse via `node:crypto` + `x509`, vérifie : expiry, SAN, chaîne.
  - Caddy config : cert/key sur volume partagé + patch config `tls <cert_path> <key_path>`.
  - Cron : `apps/api/src/worker/jobs/cert-expiry-check.ts` — scan quotidien, notif `tls.expiring_soon` (≤ 30 j).

---

### Wave 5 — Deploy hooks + rotation DB orchestrée (2 j)

- **[//] 5.A — Deploy hooks pre/post**
  - Étendre `apps` : `hooks_pre_deploy text`, `hooks_post_deploy text`, `hooks_timeout_s integer default 300`.
  - UI settings : 2 textarea + champ timeout.
  - Worker `deploy.ts` :
    1. Après build, **avant** `runBlueGreen` : spawn container éphémère (même image/env) → exec `hooks.pre_deploy`. Stream via LogBus `build:<id>`.
    2. Fail → `throw new FatalDeployError('pre_deploy failed')` (classifier sprint 3.1.1, pas de retry).
    3. runBlueGreen.
    4. Après swap OK : spawn éphémère pour `hooks.post_deploy`. Fail → `status='succeeded_with_warning'`, notif.
  - UI : badge + logs hooks dans l'onglet Builds.

- **[//] 5.B — Agent Dump/Restore RPC**
  - Étendre `packages/agent-proto/proto/agent.proto` :
    ```proto
    rpc DumpDatabase(DumpRequest) returns (stream DumpChunk);
    rpc RestoreDatabase(stream RestoreChunk) returns (RestoreResult);
    ```
  - Impl Rust `agent/ploydok-agent/src/service.rs` : `docker exec <container> pg_dumpall` (ou `redis-cli --rdb`, `mongodump`), pipe stdout en chunks 1 MB.
  - Tests Rust + integration TS.

- **[//] 5.C — RotationOrchestrator**
  - Nouveau `apps/api/src/databases/rotation.ts` — flow :
    1. Génère nouveau password.
    2. `CREATE USER <user>_new ... GRANT ALL` (Postgres) / `CONFIG SET requirepass` (Redis).
    3. Store old password en `password_history` (TTL 24 h).
    4. Update `secrets` des apps linkées (nouvelle `DATABASE_URL`).
    5. **Double-write 5 min** : pour chaque app linkée, rolling redeploy blue-green avec NEW env. Attendre healthcheck.
    6. Si toutes verts : `DROP USER <old>`.
    7. Si ≥ 1 fail : **rollback** — re-store old password, re-redeploy apps, DROP new user.
  - Notif `db.rotated` via dispatcher sprint 3.1.1.
  - Route `POST /databases/:id/rotate` (TOTP).
  - Cron BullMQ repeat : scan DB avec `rotation_schedule != 'manual'` + `password_rotated_at < now - schedule`.

- **5.D — UI rotation**
  - Page DB détail : bouton `Rotate now` (TOTP) + toggle schedule (30/60/90 j / manual).
  - Stream événements rotation (`db.rotation.step` 1..7) via SSE.

---

### Wave 6 — Backups S3/R2 + restore + scheduler (1.5 j)

- **[//] 6.A — AgeCipher**
  - Choix lock : `age` via **binary system** (Alpine/Debian packages disponibles) exécuté par l'agent.
  - Côté API : pas de lib JS custom — juste passer la clé publique user au stream.
  - Clé user : stockée **côté user uniquement** (pas en DB) — user colle sa clé publique lors du setup backup par DB.

- **[//] 6.B — Backup scheduler**
  - Nouveau `apps/api/src/worker/jobs/backup-databases.ts` :
    - BullMQ repeat `{ pattern: '0 3 * * *', tz: 'UTC' }` (override per-DB).
    - Pour chaque DB `backup_enabled=true` : dump via agent → chunks 4 MB → `age` chiffre → upload S3 `s3://bucket/<db_id>/<YYYY-MM-DD-HHMM>.age` ou local.
    - Retention : delete backups > 7 j (configurable).
  - Lib `@aws-sdk/client-s3` (compatible R2/MinIO via endpoint).

- **[//] 6.C — Restore**
  - Route `POST /databases/:id/restore` body `{ backup_id }` — TOTP + challenge texte `I understand`.
  - Flow : download → clé privée age côté client (paste modal, jamais persistée serveur) → agent `RestoreDatabase` stream → healthcheck post.
  - UI : liste backups (S3 + local) + bouton Restore + progression SSE.

- **6.D — Config storage**
  - Schema `backup_configs` : `database_id, destination_kind('s3'|'local'), s3_endpoint, s3_bucket, s3_prefix, s3_credentials_secret_id, schedule, retention_days, age_recipient_public_key, enabled`.

---

### Wave 7 — E2E + DoD + runbook (0.75 j)

- **7.A — Playwright consolidé** `apps/web/e2e/sprint4/full-flow.spec.ts` :
  1. Créer app Next.js dummy.
  2. Add env var `FOO=bar` scope prod → deploy → container a `FOO=bar`.
  3. Add domaine DNS-01 wildcard (mock DNS provider) → TLS issued.
  4. Create Postgres `small` → link app → redeploy → `/api/db` = 200.
  5. Rotate DB → `curl` toutes les 500 ms pendant rotation → 0 downtime (cap 5% 5xx max).
  6. Enable basic auth → 401 sans creds, 200 avec.
  7. Backup Postgres → restore sur nouvelle DB → schema identique.
- **7.B — Runbook** `project-docs/operations/runbooks/sprint-4-operations.md` : setup DNS-01 par provider, rotation DB, restore, budget storage.
- **7.C — DoD check** `project-docs/roadmap/sprint-4-secrets-domaines-db.md` → cocher tout + `✅ Terminé`, maj `project-docs/roadmap/README.md`.
- **7.D — Cleanup containers e2e** : `ploydok-db-e2e-*` préfixé pour purge automatique (cf. `.claude/rules/testing.md`).

---

## Budget

| Wave | Estimation | Dépendance |
|---|---|---|
| 1 — Env vars + scopes | 2 j | — |
| 2 — DNS-01 + vérification | 2 j | — |
| 3 — DB one-click + link | 2 j | W1 (secrets helpers) |
| 4 — Protection + cert manuel | 1.5 j | Caddy custom Dockerfile (W4.A) |
| 5 — Hooks + rotation | 2 j | W3 (DB lifecycle) |
| 6 — Backup + restore | 1.5 j | W3 + W5.B (Dump/Restore RPC) |
| 7 — E2E + runbook + DoD | 0.75 j | toutes |
| **Total** | **~11.75 j ouvrés** | ~2.5 semaines |

> Marge : budget commit **12 j** (+0.25 j polish). Spec initiale annonçait 1 semaine — recalibrage audit.

---

## Risques spécifiques

| Risque | Mitigation |
|---|---|
| DNS-01 provider API quota (Cloudflare 1200 req/5 min) | Cache token récent 4 min + backoff exponentiel |
| ACME rate-limit Let's Encrypt (50 certs/sem/domaine) | Env staging LE en dev, prod uniquement sur release |
| Rotation DB casse apps non-linkées (user a hardcodé) | Détection : scan `secrets` pour `DATABASE_URL=*<old_host>*` → warn UI avant rotate |
| `age` dépendance lourde | Binary system (déjà sur debian/alpine) → pas de lib JS custom côté agent |
| Backup S3 quotas / coûts | Retention 7 j default + métrique dashboard admin + alerte > 10 GB |
| Caddy `rate_limit` / DNS modules absents | **Dockerfile custom `xcaddy build` obligatoire — W4.A bloquant** |
| Deploy hooks fuient env vars en logs | Secret masking dans LogBus (grep valeurs de `secrets` et remplace `***`) |
| Restore DB = destructif | TOTP + confirm texte `I understand` + snapshot pré-restore auto |
| Cert manuel mal formé | Validation stricte `x509` + test TLS avant swap |
| Wildcard TLS multi-provider share un token | 1 provider credential = 1 secret par owner, scope user global |

---

## Fichiers critiques

### À créer
- `apps/api/src/secrets/resolver.ts` + test
- `apps/api/src/routes/secrets.ts` + test
- `apps/api/src/domains/verifier.ts` + test
- `apps/api/src/domains/dns01/{types,cloudflare,route53,ovh,digitalocean}.ts` + tests
- `apps/api/src/databases/{spawner,rotation}.ts` + `templates/*.yml` + tests
- `apps/api/src/routes/databases.ts` + test
- `apps/api/src/worker/jobs/{backup-databases,cert-expiry-check}.ts`
- `apps/api/src/crypto/age.ts`
- `apps/web/src/routes/_authed/apps/$id/{env,protection}.tsx` (refactor env)
- `apps/web/src/routes/_authed/databases/{index,$id}.tsx`
- `apps/web/src/components/secrets/{SecretsTable,AddSecretDialog,RevealSecretDialog,ImportEnvDialog}.tsx`
- `apps/web/src/components/databases/{DatabaseCard,CreateDatabaseDialog,RotationPanel,BackupsList}.tsx`
- `apps/web/src/components/protection/{BasicAuthForm,IpAllowlistForm,RateLimitForm}.tsx`
- `packages/db/src/schema/{databases,app_db_links,tls_certificates,backup_configs,password_history}.ts`
- `packages/db/migrations/NNNN_sprint4.sql` (generate + relire)
- `infra/caddy/Dockerfile` (xcaddy build)
- `project-docs/operations/runbooks/sprint-4-operations.md`
- `apps/web/e2e/sprint4/full-flow.spec.ts`

### À modifier
- `apps/api/src/caddy/client.ts` (+ middlewares + DNS-01 mode)
- `apps/api/src/worker/handlers/deploy.ts` (+ hooks pre/post + `buildEnvForDeploy`)
- `apps/api/src/app.ts` (mount secrets, databases routers)
- `apps/api/src/routes/apps-domains.ts` (DNS-01 mode + cert upload)
- `packages/db/src/schema/apps.ts` (+ protection_* + hooks_*)
- `packages/agent-proto/proto/agent.proto` (+ DumpDatabase/RestoreDatabase)
- `agent/ploydok-agent/src/service.rs` (impl Dump/Restore)
- `infra/docker-compose.yml` (build Caddy custom)
- `project-docs/roadmap/sprint-4-secrets-domaines-db.md` + `project-docs/roadmap/README.md` (✅ Terminé en fin W7)

### Réutilisables déjà en place
- `apps/api/src/keyring.ts` → `loadMasterKey()`
- `apps/api/src/auth/second-factor.ts` → `requireSecondFactor` / `requireTotpVerified`
- `apps/api/src/worker/handlers/deploy.ts` → `runBlueGreen` (rotation DB)
- `apps/api/src/notify/index.ts` → `dispatch()` pour `db.rotated`, `backup.succeeded`, `tls.expiring_soon`
- `apps/api/src/webhooks/deliveries.ts` → pattern audit réutilisable pour DB ops
- `packages/ui/src/components/*` (alert, badge, card, dialog, select, switch, tabs, field)

---

## Vérification finale (end-to-end)

Avant merge final :
```bash
bun run typecheck && bun run lint && bun test && bun run check:spdx
make db-migrate                              # migration sprint 4 up & down propre
cd agent && cargo test && cargo clippy -- -D warnings
bun --cwd apps/web exec playwright test sprint4/    # PLOYDOK_FULL_INFRA + secrets setup required
```

Manuel (infra up + dev up) :
1. `/apps/$id/env` → add `DATABASE_URL=stub` scope=prod → deploy → container a la var.
2. `/apps/$id/domains` → add wildcard → DNS-01 Cloudflare → TLS issued ≤ 2 min.
3. `/databases` → create Postgres small → link app → redeploy → `psql` OK.
4. `/databases/$id` → Rotate now → timer 5 min → rollback testé en coupant container.
5. `/apps/$id/protection` → enable IP allowlist → curl sans IP allowed = 403.
6. Schedule backup → attendre 1 cycle → check S3 → restore → data identique.
7. Upload cert manuel sur `app.example.com` → Caddy sert le cert uploadé.

---

## Checklist avant de démarrer

- [x] Sprint 3.1.1 mergé, `✅ Terminé` dans `project-docs/roadmap/README.md`.
- [x] Audit conformité Dokploy/Coolify référence (baseline 42 %, cible post-sprint-4 ≈ 65 %).
- [x] Briques existantes auditées : `secrets`, `domains`, `encryptField`, Caddy client, agent RPC, notify dispatcher.
- [x] **Décision `age`** : binary system (recommandé) vs lib JS. → Décision prise : binary system (agent Rust `docker exec age`). W6 livré.
- [x] **Décision Caddy custom Dockerfile** `xcaddy` → bloquant W4. Action : validé, intégré dans `infra/caddy/Dockerfile`. W4 livré.
- [x] **Clé user pour backup** : UX onboarding unique vs per-DB ? → Décision : per-DB (clé publique par config backup). Clé privée jamais stockée serveur.
- [x] **Providers DNS-01 prioritaires** : Cloudflare + Route53 v1 minimum, OVH + DO v1.1 → Livré les 4 en v1 (W2).
- [x] **Rotation schedule par défaut** : 90 j (spec actuelle) vs manual opt-in ? → 90 j par défaut, opt-out possible. Livré W5.

---

## Ordre d'attaque recommandé

1. **Aujourd'hui** : valider les 5 décisions checklist, puis lancer W1 + W2 en parallèle via `team-impl`.
2. **J+2** : merge W1 + W2, lancer W3 + W4 en parallèle (W4 commence par Dockerfile xcaddy).
3. **J+4** : merge W3 + W4, lancer W5 + W6 en parallèle.
4. **J+7** : W7 solo (E2E + docs).
5. **J+8** : commit + audit interne + mise à jour `project-docs/roadmap/README.md` → `✅ Terminé`.

---

## Parité feature vs Dokploy / Coolify (cible post-sprint-4)

| Feature | Dokploy | Coolify | Ploydok post-4 |
|---|---|---|---|
| Env vars chiffrées | ✅ | ✅ shared groups | ✅ 4 scopes + reveal TOTP |
| Wildcard TLS DNS-01 | ✅ | ✅ | ✅ 4 providers |
| Cert manuel | ⚠️ | ✅ | ✅ |
| DB one-click (Postgres/Redis/Mongo) | ✅ | ✅ | ✅ |
| Link app↔DB auto env | ✅ | ✅ | ✅ |
| Rotation DB password | ❌ | ❌ | ✅ **orchestrée zero-downtime** ← dépasse |
| Deploy hooks pre/post | ✅ | ✅ | ✅ |
| Basic auth + IP allowlist + rate-limit | ⚠️ | ⚠️ basique | ✅ 3 middlewares |
| Backups S3/R2 + restore | ✅ | ✅ | ✅ + chiffrement **age client-side** ← dépasse |
| Volumes persistants | ✅ | ✅ | ✅ |

Conformité estimée après sprint 4 : **~65 %** (vs 42 % aujourd'hui).

---

## Notes post-plan

- L'ancien `PLAN-sprint-4.md` (flow GitHub App Manifest, daté 2026-04-16) a été archivé → `project-docs/plans/PLAN-sprint-4-legacy-github-app.md`. Le flow GitHub App est déjà livré (sprints 3 / 3bis).
- Le sprint 3.1.2 "PR previews" consomme directement les briques W2 (DNS-01 wildcard) et W5 (hooks) — synergies à exploiter si planification serrée post-v1.0.
