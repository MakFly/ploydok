# Sprint — system_jobs : DB-anchored gate pour gc.registry ✅ Code · ⏳ e2e

> Mini-sprint sécu. Estimation **1 jour focus** (~8h).
>
> **Suivi 2026-04-27** : code + e2e ciblé verts. Le sprint reste en
> `✅ Code · ⏳ e2e` car `bun run lint` root échoue encore sur des erreurs
> préexistantes côté `apps/web` hors périmètre secops.
>
> - [x] `bunx tsc -p apps/api/tsconfig.json --noEmit`
> - [x] `bun test apps/api/src/worker/handlers/gc-registry.test.ts`
> - [x] `PLOYDOK_TEST_PG_URL=... bun test apps/api/src/worker/queue-trust.e2e.test.ts`
> - [x] `bun run check:spdx`
> - [x] `git diff --check`
> - [ ] `bun run lint` root — bloqué par erreurs existantes `apps/web`

## Contexte

Sprint 6bis (mergé) a fermé le bypass auth pour 4 queues via DB-anchored
CAS. La queue `gc.registry` était hors-scope : pas d'entité DB naturelle
sur laquelle ancrer.

L'investigation team-debug post-6bis a confirmé que c'est ancrable via
une nouvelle table `system_jobs`, et que la surface d'attaque est
**non-triviale** : `delete-app` enqueue gc.registry avec `keepPerRepo=0`
(wipe complet du registry pour une app supprimée). Un push raw Redis de
`{ appId: "production-app", keepPerRepo: 0 }` viderait le registry d'une
app vivante — disque libéré, mais zéro candidat de rollback. Sévérité
**moyenne** (impact opérationnel, pas exfiltration).

Le pattern est identique à 6bis (`enqueueWithDbRow` + `claimQueuedRow` +
`queue.audit`) — helpers déjà disponibles. La table `system_jobs` est
réutilisable pour `cleanup.build` plus tard si voulu, mais pas dans ce
scope.

## Diagramme

```
╔══════════════════════════ Avant (gc.registry — gap) ═════════════════════════╗
║                                                                              ║
║  ┌─────────────┐                ┌──────────┐                                 ║
║  │ POST /apps/ │ ── auth gate ─▶│  Redis   │  payload = { appId? }           ║
║  │ :id/        │                │ (BullMQ) │  pas d'actor, pas de DB row     ║
║  │ registry-gc │                └────┬─────┘                                 ║
║  └─────────────┘                     │                                       ║
║                                      │  ◀── push raw {appId, keepPerRepo:0}  ║
║                                      ▼      depuis qui a REDIS_URL           ║
║                              ┌──────────────┐                                ║
║                              │   worker     │  runRegistryGc({ appFilter,    ║
║                              │ gc.registry  │                  keepPerRepo}) ║
║                              └──────────────┘  pas de re-check                ║
║                                                                              ║
║  Cible : delete-app hardcode keepPerRepo=0 → injection ⇒ wipe registry       ║
║  d'une app vivante.                                                          ║
╚══════════════════════════════════════════════════════════════════════════════╝

╔══════════════════════════ Après (DB-anchored) ═══════════════════════════════╗
║                                                                              ║
║                          system_jobs (nouvelle table)                        ║
║              ┌──────────────────────────────────────────────┐                ║
║              │ id, kind='gc.registry', status='pending'     │                ║
║              │ requested_by_user_id (NULL si system)        │                ║
║              │ source ('api'|'auto:deploy'|'cron:gc'|       │                ║
║              │         'system')                            │                ║
║              │ options jsonb ({ appId?, keepPerRepo? })     │                ║
║              │ queued_at, claimed_at, finished_at           │                ║
║              └──────────────────────────────────────────────┘                ║
║                                                                              ║
║  4 producers ──INSERT row──▶ Redis {jobId} ──▶ worker.claim(jobId)           ║
║   • POST /registry-gc (admin)                                                ║
║   • auto post-deploy (deploy.ts)                                             ║
║   • cron 04:00 UTC                                                           ║
║   • delete-app aggressive (keepPerRepo=0) — ou appel direct (cf. Q ouverte)  ║
║                                                                              ║
║  worker:                                                                     ║
║   1. claimQueuedRow(system_jobs, jobId, ['pending']) → null ⇒ drop+audit     ║
║   2. row.options porte appFilter + keepPerRepo (typés Zod) — payload du     ║
║      job ne porte que jobId, donc impossible d'injecter par Redis            ║
║   3. runRegistryGc(...) avec les options validées                            ║
║   4. UPDATE system_jobs SET status='succeeded', finished_at=NOW()            ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

## DoD

- [x] Table `system_jobs` créée (migration `0031_superb_professor_monster.sql`).
- [x] Les 3 producers gc.registry **enqueueables** passent par
      `enqueueWithDbRow` :
  - `POST /apps/:id/registry-gc` → `source='api'`, actor=user.id
  - `deploy.ts` post-deploy auto → `source='auto:deploy'`, actor=null
  - cron 04:00 UTC → `source='cron:gc'`, actor=null
- [x] `delete-app.ts` garde son appel direct `await runRegistryGc(...,
    keepPerRepo: 0)` (exception documentée dans le code — le gate est
      déjà passé via `claimQueuedRow(app_delete_jobs)` en amont).
- [x] Le worker `gc.registry` ne lit plus `job.data.appId` ni
      `job.data.keepPerRepo` ; il claim le `system_jobs` row et utilise
      ses `options` typées via Zod.
- [x] Push raw `{ appId, keepPerRepo: 0 }` direct dans Redis →
      `auditUnauthorized` + zéro side-effect. Test e2e vert.
- [x] Replay sur le même `jobId` → 2e claim retourne null.
- [x] Pas de régression : POST /registry-gc continue de fonctionner,
      cron continue de tourner, delete-app continue de wiper, auto
      post-deploy continue son fire-and-forget.
- [ ] `bun run typecheck && bun run lint && bun test && bun run check:spdx`
      verts.

## Hors-scope (à part)

- `cleanup.build` : pourrait réutiliser la même table mais a un anchor
  naturel (`builds.id`). Sprint séparé si voulu.
- Wirering de `startCleanupPreviewsCron` dans `startWorker()` (orthogonal).
- Refactor de `audit_log` vers ce nouveau pattern : non-applicable
  (`audit_log` est append-only past-action, pas un job queue).
- `reapStuckSystemJobs` cron pour les rows `running` >1h (à noter, pas
  fait ici).

## Architecture

### Schéma DB

`packages/db/src/schema/system-jobs.ts` (nouveau) :

```ts
export const system_jobs = pgTable(
  "system_jobs",
  {
    id: text("id").primaryKey(),
    kind: text("kind", {
      enum: ["gc.registry"], // garde restrictif ; étendra à cleanup.build plus tard
    }).notNull(),
    status: text("status", {
      enum: ["pending", "running", "succeeded", "failed", "cancelled"],
    })
      .notNull()
      .default("pending"),
    requested_by_user_id: text("requested_by_user_id").references(
      () => users.id
    ),
    source: text("source", {
      enum: ["api", "auto:deploy", "cron:gc", "system"],
    })
      .notNull()
      .default("api"),
    options: jsonb("options")
      .notNull()
      .default(sql`'{}'::jsonb`),
    queued_at: timestamp("queued_at", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
    claimed_at: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
    finished_at: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    error_message: text("error_message"),
  },
  (t) => [
    index("system_jobs_kind_status_idx").on(t.kind, t.status),
    index("system_jobs_status_idx").on(t.status),
  ]
)
```

Schéma options validé par Zod côté handler :

```ts
const GcRegistryOptionsSchema = z.object({
  appId: z.string().nullish(), // null = scan all apps
  keepPerRepo: z.number().int().nonnegative().max(50).default(3),
})
```

### Helper enqueue (réutilisé, pas de modif)

`apps/api/src/worker/queue-enqueue.ts` — `enqueueWithDbRow` (sprint 6bis).

```ts
const { jobId } = await enqueueWithDbRow({
  db,
  queue: gcQueue,
  jobName: "gc.registry.requested",
  insertRow: (tx) =>
    tx
      .insert(system_jobs)
      .values({
        id: nanoid(),
        kind: "gc.registry",
        requested_by_user_id: actor.userId,
        source: actor.source,
        options: { appId, keepPerRepo },
      })
      .returning()
      .then((r) => r[0]),
  buildPayload: (row) => ({ jobId: row.id }),
})
```

### Worker — refactor `gc.registry`

`apps/api/src/worker/index.ts:117-127` (Worker actuel) → `claimQueuedRow`
puis lit `row.options`. Backwards-compat 1-release : si `job.data.jobId`
absent mais `job.data.appId` présent → `auditUnauthorized` warn + drop,
ne plante pas.

```ts
new Worker(
  "gc.registry",
  async (job) => {
    const { jobId } = job.data as { jobId?: string }
    if (!jobId) {
      auditUnauthorized({
        jobName: "gc.registry.requested",
        jobId: job.id ?? "",
        payload: job.data,
        reason: "legacy payload (no jobId) — drop after queue drain",
      })
      return
    }
    const claimed = await claimQueuedRow<typeof system_jobs.$inferSelect>({
      db,
      table: system_jobs,
      id: jobId,
    })
    if (!claimed) {
      auditUnauthorized({
        jobName: "gc.registry.requested",
        jobId: job.id ?? "",
        payload: job.data,
        reason: "no matching pending system_jobs row",
      })
      return
    }
    const opts = GcRegistryOptionsSchema.parse(claimed.options)
    auditClaimed({
      jobName: "gc.registry.requested",
      jobId: job.id ?? "",
      rowId: jobId,
      actor: claimed.requested_by_user_id,
      source: claimed.source,
    })

    try {
      const result = await runRegistryGc(
        opts.appId
          ? { db, appFilter: opts.appId, keepPerRepo: opts.keepPerRepo }
          : { db, keepPerRepo: opts.keepPerRepo }
      )
      await db
        .update(system_jobs)
        .set({ status: "succeeded", finished_at: new Date() })
        .where(eq(system_jobs.id, jobId))
      logger.info({ jobId, ...result }, "gc.registry done")
    } catch (err) {
      await db
        .update(system_jobs)
        .set({
          status: "failed",
          finished_at: new Date(),
          error_message:
            err instanceof Error ? err.message.slice(0, 1000) : String(err),
        })
        .where(eq(system_jobs.id, jobId))
      throw err
    }
  },
  { connection, concurrency: 1 }
)
```

## Plan par producer (ordre d'implémentation)

### 1. Schema + helpers (séquentiel, prérequis)

- `packages/db/src/schema/system-jobs.ts` (NEW) + export dans
  `schema/index.ts`.
- Migration `0031_system_jobs.sql` (`bun --cwd packages/db run generate`
  - relire le SQL).
- `bun --cwd packages/db run migrate` sur dev.
- Vérifier `bunx tsc -p packages/db --noEmit` clean.

### 2. Producer A — `POST /apps/:id/registry-gc`

`apps/api/src/routes/apps.ts:~1310` (à valider). Remplacer
`gcQueue.add(...)` par `enqueueWithDbRow` :

- `kind: "gc.registry"`
- `source: "api"`
- `requested_by_user_id: user.id`
- `options: { appId: app.id, keepPerRepo: app.keepPerRepo ?? 3 }`

### 3. Producer B — auto post-deploy

`apps/api/src/worker/handlers/deploy.ts:~1098`. Fire-and-forget actuel,
on garde la sémantique :

- `source: "auto:deploy"`, `actor: null`
- `options: { appId: app.id, keepPerRepo: 3 }`
- `.catch()` reste pour ne pas faire planter le déploiement principal.

### 4. Producer C — cron 04:00 UTC

`apps/api/src/worker/handlers/gc-registry.ts:~438`
(`startRegistryGcCron`). À chaque tick :

- `source: "cron:gc"`, `actor: null`
- `options: { appId: null, keepPerRepo: 3 }` (scan global)

Le tick ne fait plus `runRegistryGc()` directement — il enqueue dans
`gcQueue` (pour passer par le gate). Subtilité : le cron tournait jusqu'ici
en bypass total. On rebascule via la queue.

### 5. Producer D — `delete-app` aggressive ✋ exception assumée

**Décision : appel direct conservé.** `delete-app.ts` continue d'appeler
`await runRegistryGc({ db, appFilter: appId, keepPerRepo: 0 })` en
direct, sans passer par `gcQueue` ni `system_jobs`.

Justification :

- Le gate est déjà passé en amont via `claimQueuedRow(app_delete_jobs)`
  — le `keepPerRepo=0` ne peut être atteint que par un actor déjà
  authentifié pour delete cette app.
- La cascade delete est un workflow synchrone ; l'asynchroniser via la
  queue ouvre des états transitoires ("app supprimée mais GC pending").
- Aucune surface d'attaque ajoutée : un attaquant Redis ne peut pas
  pousser un job avec `keepPerRepo=0` parce que **les seuls payloads
  reconnus par le worker gc.registry sont `{ jobId }` issus de
  `system_jobs`**, et `delete-app` n'écrit jamais dans `system_jobs`.

Action obligatoire : ajouter un commentaire au call site dans
`delete-app.ts` qui documente l'exception explicitement, citant ce
sprint et la chaîne de gates en amont.

→ **3 producers** au final passent par `system_jobs` (admin, auto-deploy,
cron). `delete-app` reste direct + commenté.

### 6. Refactor worker + handler

- `apps/api/src/worker/index.ts:117-127` — appliquer le snippet
  consumer ci-dessus.
- `apps/api/src/worker/handlers/gc-registry.ts` — vérifier que
  `runRegistryGc` accepte `keepPerRepo` en option ; sinon, ajouter le
  paramètre.

### 7. Tests

`apps/api/src/worker/handlers/gc-registry.test.ts` — étendre :

- "rejects payload without jobId (legacy)" → audit + drop, zéro call à
  `runRegistryGc`.
- "rejects payload with non-existent jobId" → audit + drop.
- "claim succeeds and runs GC with options from the row" → mock
  `runRegistryGc`, vérifie qu'il est appelé avec `appFilter` +
  `keepPerRepo` lus depuis `system_jobs.options`.
- "Zod refuses keepPerRepo>50 from row" → safety net.
- "claim CAS prevents replay" → 2e claim sur même jobId retourne null.

`apps/api/src/worker/queue-trust.e2e.test.ts` — étendre avec un cas
`system_jobs` :

- INSERT system_jobs (kind=gc.registry, status=pending) → claim OK →
  status=running.
- 2e claim → null.
- Rogue ID → null.

## Fichiers touchés

| Surface    | Fichier(s)                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Schéma DB  | `packages/db/src/schema/system-jobs.ts` (NEW), `packages/db/src/schema/index.ts`                                                                                                           |
| Migration  | `packages/db/migrations/0031_system_jobs.sql` (NEW) + meta snapshot                                                                                                                        |
| Producers  | `apps/api/src/routes/apps.ts`, `apps/api/src/worker/handlers/deploy.ts`, `apps/api/src/worker/handlers/gc-registry.ts` (cron), `apps/api/src/worker/handlers/delete-app.ts` (si via queue) |
| Consumer   | `apps/api/src/worker/index.ts` (Worker `gc.registry`), `apps/api/src/worker/handlers/gc-registry.ts` (`runRegistryGc` signature)                                                           |
| Tests unit | `apps/api/src/worker/handlers/gc-registry.test.ts`                                                                                                                                         |
| Tests e2e  | `apps/api/src/worker/queue-trust.e2e.test.ts` (étendu)                                                                                                                                     |
| Roadmap    | ce fichier + `project-docs/roadmap/README.md` (slot 6ter)                                                                                                                                          |

## Migration des jobs en flight

Mêmes règles que 6bis :

1. **Dev** : `redis-cli -p 6381 -a $PLOYDOK_REDIS_PASSWORD FLUSHDB` avant
   redémarrage des workers.
2. **Prod** : drain script, sinon les jobs pré-migration sont droppés
   avec audit log "no jobId / legacy payload" — bénin mais bruyant.

## Vérification end-to-end

```bash
make db-migrate
bun test apps/api/src/worker/handlers/gc-registry.test.ts
bun test apps/api/src/worker/queue-trust.e2e.test.ts
bunx tsc -p apps/api/tsconfig.json --noEmit  # ne doit pas régresser le baseline 14
bun run check:spdx
bun run lint

# Smoke manuel
make agent-restart      # dev only
# 1. POST /apps/:id/registry-gc via UI → audit log "auditClaimed source=api"
# 2. Push raw : bun -e 'import {Queue} from "bullmq"; const q = new Queue("gc.registry", {...});
#                       q.add("gc.registry.requested", {appId: "x", keepPerRepo: 0})'
#    → audit "auditUnauthorized reason=legacy payload (no jobId)"
#    → vérifier que le registry n'a pas perdu de tags
# 3. Cron 04:00 → row system_jobs créée, claim, GC tourne, status=succeeded
```

## Risques

- **Cron qui tournait en bypass direct** : si on bascule via la queue,
  un crash worker laisse la row `pending` indéfiniment. Mitigation :
  ajouter un reaper sur `system_jobs` pour les rows `running` >1h
  (`reapStuckSystemJobs` cron, miroir de `reapStuckBuilds`). Hors-scope
  immédiat, à noter.
- **Backwards-compat un release** : pendant le déploiement, des jobs
  legacy `{appId}` peuvent traîner. Le drop est gracieux + audité.
- **Surface delete-app** : voir Q ouverte.
- **Race condition cron + manuel** : un user clique "registry GC" pendant
  que le cron tourne → 2 rows pending. Le worker concurrency=1 sérialise.
  Bénin.

## Estimation

| Étape                     | Coût |
| ------------------------- | ---- |
| Schéma + migration        | 1h   |
| Helper (réutilisé)        | 0    |
| 4 producers refactor      | 2h   |
| Worker + handler refactor | 1.5h |
| Tests unit + e2e          | 2h   |
| Smoke + vérification      | 1h   |
| Doc + commit propre       | 0.5h |

**Total : ~8h** soit 1 jour focus.

## Sortie

- `system_jobs` table active, 5 statuts, indexée.
- 4 producers gc.registry passent par le gate (3 ou 4 selon Q ouverte).
- Push raw Redis ne peut plus déclencher un GC (test e2e vert).
- `delete-app` reste le seul à passer `keepPerRepo=0`, traçable via
  `system_jobs.source = 'system'` (si enqueue) ou commentaire explicite
  (si direct).
- Pas de régression sur les flux normaux.
