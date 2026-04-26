# Sprint — Queue trust boundary ⏳ À faire

> Hardening sécu : fermer le bypass auth via Redis. Estimation **2 jours focus**.

## Contexte

Aujourd'hui les routes API font `getAppForUser(db, appId, user.id)` avant
`deployQueue.add(...)`, mais le worker qui consomme le job ne re-vérifie
pas l'ownership et ne sait pas qui a déclenché l'action. Conséquence :
toute personne avec accès à `REDIS_URL` (le contenu de `apps/api/.env.local`
en dev, ou un mouvement latéral dans le compose network en prod) peut
pousser un payload `{appId}` arbitraire et déclencher un deploy / delete
/ domain.verify sans authentification.

Démontré en pratique pendant le commit `0368414` : le repo a été
redéployé sans cookie, sans CSRF, sans `getAppForUser`, juste par push
direct BullMQ via `bun -e "queue.add(...)"`. C'est exactement ce qu'un
attaquant qui a compromis l'API ferait — et le modèle prod (Redis interne,
agent isolé) ne ferme pas ce gap, il le réduit seulement.

Décision : on ferme le gap **en dev ET en prod avec le même mécanisme**
pour avoir une sécu iso entre les deux environnements et ne pas se
construire de fausse confiance.

Approche choisie (inspirée de Coolify, cf.
`/tmp/coolify/app/Jobs/ApplicationDeploymentJob.php`) :
**la DB est le gate**. Le payload de queue ne porte qu'un FK opaque
(`buildId`, `domainId`, `appId+jobId`). Le worker fait un CAS atomique sur
`status='queued' → 'running'` avant de toucher quoi que ce soit ; si la
row n'existe pas (push direct sans passer par l'API), le job est droppé +
audit. Pas de secret HMAC à propager.

## Diagramme

```
╔═════════════════════════════ Avant (gap actuel) ═════════════════════════════╗
║                                                                              ║
║  ┌─────────────┐  auth gate    ┌──────────┐                                  ║
║  │ API route   ├──────────────▶│  Redis   │  payload = { appId }             ║
║  │ POST deploy │  user check   │ (BullMQ) │  pas d'actor, pas de DB row      ║
║  └─────────────┘               └────┬─────┘                                  ║
║                                     │                                        ║
║          push raw {appId} ──────────┤  ← bypass possible avec REDIS_URL      ║
║          depuis n'importe où        │                                        ║
║                                     ▼                                        ║
║                              ┌──────────────┐                                ║
║                              │   worker     │  crée build row au démarrage   ║
║                              │   handler    │  pas de re-check actor         ║
║                              └──────────────┘  pas d'audit consumer          ║
╚══════════════════════════════════════════════════════════════════════════════╝

╔═════════════════════════════ Après (DB-anchored) ════════════════════════════╗
║                                                                              ║
║  ┌─────────────┐                                                             ║
║  │ API route   │ 1. auth check ──▶ getAppForUser()                           ║
║  │ POST deploy │ 2. INSERT builds (id, app_id, status='queued',              ║
║  └──────┬──────┘                   requested_by_user_id=user.id,             ║
║         │                          source='api', queued_at=now())            ║
║         │ 3. queue.add({ buildId })  ◀── payload minimal, juste le FK        ║
║         ▼                                                                    ║
║   ┌──────────┐                                                               ║
║   │  Redis   │  push raw {buildId=fake} ─┐                                   ║
║   └────┬─────┘                           │                                   ║
║        │                                 ▼                                   ║
║        ▼                          worker.claim(buildId) :                    ║
║  ┌──────────────┐                 UPDATE builds SET status='running'         ║
║  │   worker     │                 WHERE id=$1 AND status='queued'            ║
║  │   handler    │                 RETURNING * ──▶ 0 rows ⇒ drop + audit      ║
║  └──────┬───────┘                                                            ║
║         │ 4. row.requested_by → si non-NULL : re-check ownership             ║
║         │    sinon : source doit être 'webhook:*', 'cron:*', 'auto:*'        ║
║         │ 5. audit.log("queue.consume", { buildId, actor, source })          ║
║         ▼                                                                    ║
║    deploy continues with verified context                                    ║
╚══════════════════════════════════════════════════════════════════════════════╝

── Légende ───────────────────────────────────────────────────────────────────
  ──▶  flux de données     ◀──  validation/retour
  La DB est le gate, pas la signature : pas de secret partagé à propager.
  CAS atomique sur status='queued' protège contre replay et injection.
```

## DoD

- [ ] Push direct BullMQ avec un payload sans row DB correspondante → job
      rejeté avec audit log `queue.unauthorized`. Test e2e vert.
- [ ] Toute insertion en queue depuis l'API porte `requested_by_user_id`
      (ou `NULL` + `source` non-utilisateur) traçable jusqu'au consumer.
- [ ] Le worker logue à la consommation : `{ jobName, jobId, entityId,
    actor, source, claimed_at }` — pino niveau `info` sur le logger
      `queue.audit`.
- [ ] CAS atomique sur le claim : aucun job ne peut être consommé deux
      fois (replay protection).
- [ ] Les triggers internes (cron, webhook GitHub, auto-deploy) écrivent
      une row DB avec `requested_by_user_id=NULL` et `source ∈ {webhook:gh,
    cron:gc, auto:push, …}`.
- [ ] Les 4 queues high-priority migrées : `deploy`, `app.delete`,
      `domain.verify`, `provider.repos.sync`.
- [ ] Test unit + e2e par queue : (a) producer écrit la row, (b) consumer
      CAS-claim, (c) drop sur push raw.
- [ ] `bun run typecheck && bun run lint && bun test && bun run check:spdx`
      verts.

## Non-couvert (sprint suivant si besoin)

- `gc.registry` et `cleanup.build` : pas d'entité DB naturelle. Approche
  séparée (table `system_jobs` ou signature HMAC dédiée). Risque faible :
  pas de state change, juste cleanup.
- `previewTeardown` : queue importée mais non exportée de `queues.ts` (bug
  référence dangling dans `apps/api/src/worker/jobs/cleanup-previews.ts:7`).
  À résoudre dans le sprint qui finalise les preview deployments.
- Encryption des payloads BullMQ at-rest (Coolify le fait via
  `ShouldBeEncrypted`). Faible valeur si la DB porte la vérité — la fuite
  Redis ne donne plus l'autorisation. Skip.
- Rotation de secrets / KMS pour les workers. Non applicable dans ce design
  (pas de secret partagé).

## Architecture

### Schéma DB

`packages/db/src/schema/builds.ts` — colonnes à ajouter :

```ts
requested_by_user_id: text("requested_by_user_id").references(() => users.id),
source: text("source", {
  enum: ["api", "webhook:github", "webhook:gitlab", "cron:gc",
         "cron:cleanup", "auto:push", "auto:tag", "system"]
}).notNull().default("api"),
queued_at: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
claimed_at: timestamp("claimed_at", { withTimezone: true }),
```

Index : `CREATE INDEX builds_status_idx ON builds(status) WHERE status IN ('queued','running')`.

Idem pour : `domains` (verify), `provider_credentials` (repo sync), et
nouvelle table `app_delete_jobs` (le row `apps` est marqué
`status='deleting'` mais on a besoin d'une trace post-suppression).

### Helpers nouveaux

| Fichier                                | Rôle                                                                                                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/worker/queue-enqueue.ts` | `enqueueWithDbRow({ db, queue, jobName, insertRow, buildPayload, jobOptions })` — transaction `INSERT row + queue.add`, rollback row si enqueue fail                                          |
| `apps/api/src/worker/queue-claim.ts`   | `claimQueuedRow({ db, table, id, expectedStatuses=["queued"] })` — `UPDATE … SET status='running', claimed_at=now() WHERE id=$1 AND status IN (...) RETURNING *`, retourne null si CAS échoue |
| `apps/api/src/worker/queue-audit.ts`   | logger pino dédié `queue.audit` avec `auditClaimed`, `auditUnauthorized` (warn), `auditDuplicateClaim` (warn)                                                                                 |

### Pattern par handler

```ts
// Avant
async function handleDeploy(job) {
  const { appId, commitSha } = job.data
  const buildId = nanoid()
  await insertBuild(db, { id: buildId, appId, ... })
  // … deploy
}

// Après
async function handleDeploy(job) {
  const { buildId } = job.data
  const claimed = await claimQueuedRow({ db, table: builds, id: buildId })
  if (!claimed) {
    queueAudit.auditUnauthorized({
      jobName: "deploy.requested", jobId: job.id, payload: job.data,
      reason: "no matching queued build row",
    })
    return  // pas de retry sur job invalide
  }
  queueAudit.auditClaimed({
    jobName: "deploy.requested", jobId: job.id, rowId: buildId,
    actor: claimed.requested_by_user_id, source: claimed.source,
  })
  if (claimed.requested_by_user_id !== null) {
    const app = await getAppForUser(db, claimed.app_id, claimed.requested_by_user_id)
    if (!app) {
      await markBuildFailed(db, buildId, "user lost access during queue wait")
      return
    }
  }
  // … deploy avec contexte vérifié
}
```

## Plan par queue (ordre d'implémentation)

### Queue 1 — `deploy` (canonical, le plus critique)

1. **Migration DB** `0028_builds_actor.sql` — add `requested_by_user_id`,
   `source`, `queued_at`, `claimed_at` + index.
2. **Producers** :
   - `apps/api/src/routes/apps.ts:580` (POST /apps) → `enqueueWithDbRow`,
     `source='api'`, `actor=user.id`.
   - `apps/api/src/routes/apps.ts:833` (POST /apps/:id/deploy) → idem.
   - Auto-deploy push (`apps/api/src/webhook-handlers/push.ts` si présent) →
     `source='auto:push'`, `actor=null`.
   - Webhook deploy externe → `source='webhook:gh'`, `actor=null`.
3. **Consumer** : `apps/api/src/worker/handlers/deploy.ts:270-278` —
   remplace `insertBuild` par `claimQueuedRow`. Le payload de queue passe
   de `{appId, commitSha}` à `{buildId}`.
4. **Tests** :
   - `deploy.test.ts` : 3 cas — claim succès, claim sur row absente, claim
     concurrent (CAS échec sur 2e claim).
   - Nouveau e2e `deploy-queue-trust.e2e.test.ts` : push raw `{buildId:
"nope"}` direct via redis client → audit log + zéro side-effect.

### Queue 2 — `app.delete`

1. **Migration DB** : nouvelle table `app_delete_jobs` (id, app_id, status,
   actor, source, options jsonb, queued_at, claimed_at, finished_at).
2. **Producer** : `apps/api/src/routes/apps.ts:804-807` (DELETE /apps/:id) →
   crée la row puis `queue.add({ jobId })`.
3. **Consumer** : `apps/api/src/worker/handlers/delete-app.ts` → claim via
   `claimQueuedRow`. **Bonus** : créer le test manquant (handler n'a pas de
   test aujourd'hui).
4. **Tests** : nouveau `delete-app.test.ts` couvrant claim + drop.

### Queue 3 — `domain.verify`

1. **Migration DB** : ajouter `requested_by_user_id`, `source`, `claimed_at`
   à `domains` (rows existantes, on les enrichit).
2. **Producers** : 3 sites dans `apps/api/src/routes/apps-domains.ts`
   (260, 366, 489) → enrichir avec actor.
3. **Consumer** : `apps/api/src/worker/handlers/domain-verify.ts` → claim.
   **Subtilité** : 20 retries par job (`domainVerifyDefaults`). La 1ère
   attempt fait CAS `queued→running`, les retries font CAS `running→running`
   (no-op) au lieu de drop. `claimQueuedRow` doit accepter
   `expectedStatuses: ["queued", "running"]` pour ce cas.
4. **Tests** : nouveau `domain-verify.test.ts` (n'existe pas).

### Queue 4 — `provider.repos.sync`

1. **Migration DB** : ajouter `last_sync_actor_user_id`, `last_sync_source`
   à `provider_credentials` (ou créer `provider_sync_jobs` si historique
   souhaité).
2. **Producers** : `ig "providerReposSyncQueue"` puis enrichir.
3. **Consumer** : `sync-provider-repos.ts` → claim.
4. **Tests** : étendre `sync-provider-repos.test.ts`.

## Fichiers touchés

| Surface        | Fichier(s)                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| Schémas DB     | `packages/db/src/schema/{builds,domains,provider-credentials}.ts`, nouveau `app-delete-jobs.ts`            |
| Migrations     | `packages/db/migrations/0028_*.sql`                                                                        |
| Helpers worker | `apps/api/src/worker/{queue-enqueue,queue-claim,queue-audit}.ts` (nouveaux)                                |
| Producers      | `apps/api/src/routes/apps.ts` (2 sites), `apps/api/src/routes/apps-domains.ts` (3 sites), webhook-handlers |
| Consumers      | `apps/api/src/worker/handlers/{deploy,delete-app,domain-verify,sync-provider-repos}.ts`                    |
| Tests unit     | `deploy.test.ts` (étendu), nouveaux `delete-app.test.ts` + `domain-verify.test.ts`                         |
| Tests e2e      | nouveau `apps/api/src/worker/queue-trust.e2e.test.ts`                                                      |
| Roadmap        | ce fichier + `docs/sprints/README.md`                                                                      |
| Drizzle config | regen via `bun --cwd packages/db run generate`                                                             |

## Migration des jobs en flight

Quand cette release ship :

1. **Dev** : `redis-cli -p 6381 -a $PLOYDOK_REDIS_PASSWORD FLUSHDB` avant
   le redémarrage des workers. À documenter dans le runbook.
2. **Prod** : `bun --cwd apps/api run scripts/drain-queues.ts` (à écrire)
   qui attend `Queue.waiting().length === 0` puis bascule. Sinon les jobs
   pré-migration sont droppés (audit log "no matching row") — bénin mais
   bruyant.

## Vérification end-to-end

```bash
# Migrations
make db-migrate

# Unit
bun test apps/api/src/worker/handlers/deploy.test.ts
bun test apps/api/src/worker/handlers/delete-app.test.ts
bun test apps/api/src/worker/handlers/domain-verify.test.ts
bun test apps/api/src/worker/handlers/sync-provider-repos.test.ts

# E2E (queue trust)
bun test apps/api/src/worker/queue-trust.e2e.test.ts

# Sanity
bunx tsc -p apps/api/tsconfig.json --noEmit
bun run check:spdx
bun run lint

# Smoke manuel
make agent-restart
# 1. Déploie via UI une app smoke (clic redeploy) → builds.requested_by_user_id=user, source='api'
# 2. Push raw : `bun -e 'import { Queue } from "bullmq"; ...
#                       q.add("deploy.requested", { buildId: "nope" })'`
#    → vérifie : (a) zéro container spawn, (b) log queue.audit
#    `auditUnauthorized` avec reason="no matching queued build row"
# 3. Auto-deploy via webhook GitHub (push sur la branche tracée) →
#    builds.requested_by_user_id=null, source='auto:push'
```

## Risques

- **Drift entre `apps.status` et `app_delete_jobs`** : aujourd'hui
  `apps.status='deleting'` est le seul tracker. La nouvelle table fait
  double-emploi pendant la transition. Mitigation : la phase de delete
  reste idempotente (ré-enqueuable sur plantage), la row jobs ne pilote
  pas le state machine de l'app.
- **Tests qui mocketent la DB** (`runner.test.ts`) ne testent pas le CAS
  réel. On garde des unit tests pour la logique mais on AJOUTE un test
  e2e contre Postgres réel pour le claim. Pas régressé : les unit tests
  existants tournent toujours sur des mocks.
- **Domain verify retries** : la nuance `expectedStatuses: ["queued",
"running"]` doit être bien gardée — sinon les retries dropent au lieu
  de re-tenter. Couvert par un test dédié.
- **Race condition** : deux producers qui tentent d'écrire la même `id` →
  contention DB. Le `INSERT` est en transaction avec l'enqueue, l'id est
  généré côté API (`nanoid`), donc collision improbable. Pas de garde
  supplémentaire.

## Sortie

À la fin du sprint :

- 4 queues protégées par DB-anchored CAS.
- Audit logger `queue.audit` actif avec entrées par job consommé.
- Push direct Redis sans row DB correspondante → drop instrumenté.
- Test e2e qui le démontre, partie intégrante du DoD CI.
- Pas de régression sur les flux existants (deploy normal, delete, domain
  verify, sync repos).

Estimation : **2 jours** focus (1 jour deploy queue + helpers, 0.5 jour
les 3 autres queues, 0.5 jour migration tests + runbook).
