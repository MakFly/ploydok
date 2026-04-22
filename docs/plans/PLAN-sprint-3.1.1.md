# PLAN — Sprint 3.1.1 : Webhook Auto-Deploy

> Plan d'implémentation détaillé du sprint `docs/sprints/sprint-3.1.1-webhook-autodeploy.md`.
> Calibré sur l'état réel du code (audit 2026-04-21).
>
> **Décisions lockées 2026-04-21** :
> 1. **Livraison one-shot** : Waves 1+2+3+4+6. ~10 j ouvrés. Pas de split `a/b`.
> 2. **Dette double-enqueue supprimée** : BullMQ uniquement, retirer les inserts Postgres `jobs`. Une seule source de vérité pour les jobs async (wave 2.F devient obligatoire, pas optionnelle).
> 3. **PR previews hors-scope** : Wave 5 **retirée** de ce sprint. Reportée dans un futur `sprint-3.1.2` ou alignée avec le wildcard TLS du sprint 4.
>
> **Durée : ~10 j ouvrés**. La spec annonçait 5 j — réalité calibrée audit.

---

## Architecture cible

```
                               push event
┌─ GitHub/GitLab ─┐    (HMAC / token)   ┌─ Caddy ingress ─┐
│   MakFly/repo   │──────────────────▶  │  :8543 TLS      │
└─────────────────┘                     └────────┬────────┘
                                                 │ POST /{provider}/webhook
                                                 ▼
╔═══════════════════ API Hono :3335 ═══════════════════════════════╗
║                                                                  ║
║  1. rate-limit sliding window  (Redis ZSET key=install/token)    ║
║     └─ 429 + delivery row decision=error reason=rate_limited     ║
║                                                                  ║
║  2. detectProviderFromHeaders → GitProvider (registry)           ║
║                                                                  ║
║  3. verifyWebhookSignature (dual-accept : secret + old 24 h)     ║
║     └─ invalide → delivery decision=invalid_signature + 401      ║
║                                                                  ║
║  4. parseWebhookPushEvent → ParsedPushEvent                      ║
║                                                                  ║
║  5. resolve app (git_provider+repo_full_name+branch)             ║
║     └─ pas d'app → decision=skipped_unknown_app + 200            ║
║                                                                  ║
║  6. filters chain                                                ║
║      ┌─ auto_deploy_enabled?  → skipped_disabled                 ║
║      ├─ branch strict match?   → skipped_branch                  ║
║      ├─ watch_paths glob?      → skipped_path                    ║
║      └─ [skip deploy|ci] msg?  → skipped_directive               ║
║                                                                  ║
║  7. INSERT webhook_deliveries (decision + payload_raw + hash)    ║
║                                                                  ║
║  8. si enqueued :                                                ║
║     deployQueue.add({...}, { jobId: `deploy:${appId}:${branch}`, ║
║                              attempts:3, backoff:exp(5s) })      ║
║     └─ si jobId déjà waiting → coalesce (drop vieux, new gagne)  ║
║                                                                  ║
╚═══════════════════════════════╤══════════════════════════════════╝
                                │ BullMQ Redis
                                ▼
╔═══════════════════ Worker (concurrency 1) ═══════════════════════╗
║  ┌─ build.started hook ─▶ commitStatus(pending) + notify         ║
║  │                                                               ║
║  │  runBlueGreen (existant sprint 3)                             ║
║  │   ├─ TransientDeployError → BullMQ retry (attempts 3, exp bo) ║
║  │   └─ FatalDeployError     → fail immédiat, pas de retry       ║
║  │                                                               ║
║  └─ build.finished hook ─▶ commitStatus(success|failure) + notify║
╚═══════════════════════════════╤══════════════════════════════════╝
                                │ Caddy Admin API :2020
                                ▼
                    ┌─ app container swap ─┐
                    │  Blue ⇄ Green        │
                    └──────────────────────┘

── Legend ──────────────────────────────────────────────────────────
  ──▶  HTTP synchrone        ═══  Module boundary
  coalesce = BullMQ jobId déterministe ; nouveau push remplace l'ancien waiting
  dual-accept = secret + secret_old pendant 24 h (rotation zero-downtime)

── Composants ──────────────────────────────────────────────────────
  Rate-limit      : Redis ZSET, 100 req/min/installation_id|token
  Deliveries audit: table webhook_deliveries (+ payload_raw 30 j TTL)
  Commit status   : GitHub `/statuses/:sha`, GitLab `/statuses/:sha`
  Notifier        : Discord webhook / Slack blocks / email SMTP (mailpit dev)
  PR previews     : app éphémère `<id>-pr-<n>`, wildcard TLS (dépend sprint 4)
```

---

## État du code (audit 2026-04-21)

Source de vérité avant de coder — **lire avant de modifier** :

| Sujet | Fichier actuel | État |
|---|---|---|
| Webhook GitHub | `apps/api/src/routes/github.ts:503` + `apps/api/src/github/webhook.ts:35` | Signature HMAC OK, double-enqueue Postgres `jobs` + BullMQ (dette) |
| Webhook GitLab | `apps/api/src/routes/gitlab.ts:313` + `apps/api/src/gitlab/webhook.ts:37` | Token plain-text (spec GitLab), actif |
| Push handler shared | `apps/api/src/github/webhook-handlers/push.ts:20` (`handlePushGeneric`) | Résout app par `(provider, repo, branch)`, enqueue `attempts: 1` hardcodé |
| Registry providers | `apps/api/src/providers/index.ts:33` | `getProvider`, `detectProviderFromHeaders` — OK pour 3.1.1 |
| BullMQ queues | `apps/api/src/worker/queues.ts:8` | `deploy`, `gc.registry`, `cleanup.build`, `app.delete` — aucun backoff, aucun jobId déterministe |
| Worker deploy | `apps/api/src/worker/index.ts:43` → `handlers/deploy.ts` | `concurrency: 1`, pas de classifier transient/fatal |
| Schema `apps` | `packages/db/src/schema/apps.ts` | `branch`, `watch_paths` OK ; manquent `auto_deploy_enabled`, `post_commit_status`, `coalesce_pushes`, `deploy_on_tag`, `webhook_secret`, `webhook_secret_old`, `webhook_secret_old_expires_at` |
| Audit log | `packages/db/src/schema/audit-log.ts` | Chaîne HMAC `prev_hash` + `hash` — style à suivre |
| `webhook_deliveries` | — | **À créer** |
| Commit status | — | **Zéro code**. Token dispo via `resolveInstallationTokenForApp` (`worker/handlers/deploy.ts:137`) |
| `requireSecondFactor` | — | **N'existe pas**. À créer avant le replay endpoint (3.1.1.4). Endpoints TOTP existent mais pas de guard générique |
| UI settings | `apps/web/src/routes/_authed/apps/$id/settings.tsx:13` | Page plate, pas de sub-tabs. **Introduire** layout + Outlet |
| Redis client | `packages/db/src/client.ts:14` (`createRedis`) | Pas de singleton global, multi-instantiation |

---

## Découpage en Waves

Chaque wave = ~1–2 j ouvrés. Les items préfixés `[//]` sont **parallélisables** dans la wave (teammates indépendants).

### Wave 1 — Fondations (2 j)

Objectif : déverrouiller les autres waves. Rien ne construit dessus avant que Wave 1 soit mergée.

- **[//] 1.A — Schema apps + migration**
  - Ajouter colonnes à `packages/db/src/schema/apps.ts` : `auto_deploy_enabled boolean default true`, `post_commit_status boolean default true`, `coalesce_pushes boolean default true`, `deploy_on_tag boolean default false`, `tag_pattern text nullable`, `webhook_secret bytea` (chiffré), `webhook_secret_old bytea nullable`, `webhook_secret_old_expires_at timestamptz nullable`.
  - Générer migration `bun --cwd packages/db run generate`, relire le SQL, appliquer `make db-migrate`.
  - Backfill : migration SQL injecte `auto_deploy_enabled=true` sur apps existantes.

- **[//] 1.B — Table `webhook_deliveries`**
  - Nouveau schema `packages/db/src/schema/webhook-deliveries.ts` strictement conforme à la spec §3.1.1.3.
  - Ajouter `parent_delivery_id text nullable references webhook_deliveries(id)` pour les replays.
  - Ajouter `payload_raw bytea` + colonne `payload_raw_expires_at timestamptz` (TTL 30 j, compress gzip avant insert).
  - Ajouter `retry_count integer default 0`.
  - Index : `(app_id, received_at desc)`, `(payload_hash)` pour dedup rapide.
  - Export dans `schema/index.ts`.

- **[//] 1.C — Middleware `requireSecondFactor`**
  - Nouveau `apps/api/src/auth/second-factor.ts`.
  - Vérifie soit cookie `ploydok_2fa_verified` (fresh ≤ 15 min), soit header `X-TOTP-Code` vérifié contre `totp_secrets`.
  - Si ni l'un ni l'autre : 403 + body `{ code: "totp_required" }`.
  - Audit log sur succès (`action: "2fa.verified"`).
  - **Réutilisable** pour sprint 4 et 6 (secrets reveal, API tokens) — design pour pas être webhook-specific.
  - Tests unitaires obligatoires.

- **[//] 1.D — Layout settings avec sub-tabs**
  - Refacto `apps/web/src/routes/_authed/apps/$id/settings.tsx` en layout (header + `<Outlet/>`).
  - Créer sous-routes : `settings/index.tsx` (General), `settings/webhooks.tsx`, `settings/webhook-secret.tsx`.
  - Déplacer les champs existants dans `settings/index.tsx` — zéro perte fonctionnelle.
  - Mettre à jour `.claude/rules/monorepo.md` section routes.

**Validation Wave 1** : `bun run typecheck && bun run lint && bun test && bun run check:spdx` verts. Migration applique + rollback propre sur DB fraîche.

---

### Wave 2 — Logique handler & enqueue (3 j)

Objectif : le flow `push → delivery logged → job enqueued` est complet, auditable, coalescé, rate-limité.

- **[//] 2.A — Filtres dans `handlePushGeneric`**
  - Éditer `apps/api/src/github/webhook-handlers/push.ts`.
  - Implémenter la chaîne de filtres dans l'ordre spec §3.1.1.2.
  - Glob matching `watch_paths` via `Bun.glob` (préférer stdlib ; fallback `picomatch` si limité). Tests unitaires : `apps/web/**` matche `apps/web/src/foo.ts`, pas `apps/api/foo.ts`.
  - Directive `[skip deploy|skip ci|no deploy]` → regex case-insensitive sur `head_commit.message`.
  - Retourne un `Decision` typé : `{ decision: DecisionEnum, reason: string }`.

- **[//] 2.B — Écriture `webhook_deliveries` + dedup**
  - Nouveau module `apps/api/src/webhooks/deliveries.ts` (`insertDelivery`, `findByPayloadHash`).
  - Appelé **dans tous les cas** (même `invalid_signature`, même `skipped_unknown_app`).
  - `payload_hash` = SHA-256 raw body. Si dedup trouvé < 60 s : ne pas réinsérer, retourner 200.
  - `payload_raw` compressé gzip avant insert ; cap 1 MB, truncate au-delà avec flag `payload_truncated`.

- **[//] 2.C — Coalescing BullMQ**
  - Éditer `apps/api/src/worker/queues.ts` : exporter `deployQueue` avec `defaultJobOptions: { removeOnComplete: 100, removeOnFail: 500 }`.
  - `apps/api/src/github/webhook-handlers/push.ts` : passer `jobId: \`deploy:${appId}:${branch}\``, `attempts: 3`, `backoff: { type: 'exponential', delay: 5000 }`.
  - Avant `add`, check `deployQueue.getJob(jobId)` : si status `waiting` ou `delayed` → `removeJob()` puis ajouter le nouveau. Si `active` → laisser finir, créer nouveau jobId suffixé `:r<n>`.
  - Respecter `apps.coalesce_pushes` : si `false`, jobId aléatoire.
  - Métrique : log `{ event: "webhook.coalesced", app_id, dropped_job_id }`.
  - Audit : delivery dropée marquée `decision=coalesced`.

- **[//] 2.D — Retry classifier transient vs fatal**
  - Nouveau `apps/api/src/worker/errors.ts` : classes `TransientDeployError`, `FatalDeployError`.
  - Éditer `apps/api/src/worker/handlers/deploy.ts` : wrap les erreurs connues.
    - Agent gRPC down / unreachable, Redis timeout, Docker pull transient 5xx → `TransientDeployError`.
    - Dockerfile parse error, `nixpacks` fail, registry auth invalide, image introuvable → `FatalDeployError`.
  - Dans le worker processor : `if (err instanceof FatalDeployError) throw new UnrecoverableError(err.message)` (BullMQ skip retry). Sinon laisser BullMQ retry.
  - Audit : delivery updated `retry_count++` à chaque attempt.

- **[//] 2.E — Rate-limit ingress**
  - Nouveau `apps/api/src/webhooks/rate-limit.ts` : sliding window Redis ZSET.
  - Clé : `ratelimit:webhook:${provider}:${installationIdOrToken}`.
  - Fenêtre : 60 s, limite `instance_settings.webhook_rate_limit_per_min` (default 100).
  - Dépassement → 429, delivery `decision=error` `reason=rate_limited`.
  - Tests : 101 req en < 1 min → 100 OK + 1 429.

- **2.F — Supprimer le double-enqueue Postgres `jobs` + BullMQ** *(obligatoire, décision lockée)*
  - Retirer `enqueueJob(db, ...)` dans `apps/api/src/github/webhook-handlers/push.ts:74-79` + tous ses call-sites.
  - Vérifier qu'aucun consumer ne lit la table `jobs` (audit : elle n'est utilisée nulle part — `ig "from(jobs)"` + `ig "SELECT .* jobs"` doivent revenir vides).
  - Migration Drizzle : `DROP TABLE jobs` + suppression du schema `packages/db/src/schema/jobs.ts`.
  - Si un consumer apparaît → ADR séparé avant de drop. Sinon, commit dans la même PR que 2.C (coalescing) pour cohérence.
  - Audit log `action="schema.jobs.dropped"` pour tracer.

**Validation Wave 2** : tests unitaires + test d'intégration handler (spawn API en mode test, fake push, assertions sur DB delivery + BullMQ state).

---

### Wave 3 — Callbacks externes + UI deliveries (2 j)

- **[//] 3.A — Commit status GitHub + GitLab**
  - Nouveau `apps/api/src/providers/commit-status.ts` : méthode `postCommitStatus({ provider, app, sha, state, context, targetUrl, description })`.
  - Ajouter méthode à l'interface `GitProvider` dans `packages/shared/src/git-providers.ts` : `postCommitStatus(input): Promise<void>`.
  - Implémenter sur `GitHubProvider` (appel `POST /repos/:owner/:repo/statuses/:sha` via installation token) et `GitLabProvider` (`POST /projects/:id/statuses/:sha`).
  - Hooks dans `worker/handlers/deploy.ts` :
    - Avant `runBlueGreen` → `pending` (`context="ploydok/build"`, `target_url=/apps/:id/builds/:buildId/logs`).
    - Succès → `success`. Échec fatal → `failure`. Exception non-classifiée → `error`.
  - Respecter `apps.post_commit_status` toggle.
  - Dedup best-effort : cache Redis `status:sent:${sha}:${context}:${state}` TTL 60 s pour éviter doublons sur retries.

- **[//] 3.B — UI table deliveries + modal détails**
  - Route `apps/web/src/routes/_authed/apps/$id/settings/webhooks.tsx`.
  - Composant `WebhookDeliveriesTable.tsx` : colonnes `received_at`, `event`, `branch`, `commit (truncated + lien GitHub)`, `decision Badge` (color par enum), bouton `⟲ Replay`.
  - Pagination cursor-based (query param `cursor`).
  - Modal `DeliveryDetailsDialog.tsx` : tabs `Payload` (JSON pretty), `Decision`, `Build link`, bouton **Redeliver** (→ wave 4).
  - API : nouvelle route `GET /apps/:id/webhook-deliveries` dans `apps/api/src/routes/apps.ts`, auth + ownership.

- **[//] 3.C — UI toggle & réglages app**
  - `settings/index.tsx` : ajouter `AutoDeploySwitch`, `PostCommitStatusSwitch`, `CoalesceSwitch`, `DeployOnTagSwitch` + champ `tag_pattern` conditionnel.
  - `settings/webhook-secret.tsx` : afficher le secret masqué, bouton `Rotate` (désactivé si rotation récente < 24 h).

- **[//] 3.D — Rotation secret**
  - Endpoint `POST /apps/:id/webhook-secret/rotate` protégé par `requireSecondFactor`.
  - Génère nouveau secret (`crypto.randomBytes(32).toString("hex")`), déplace l'ancien dans `webhook_secret_old` avec expiry `now + 24h`.
  - `verifyWebhookSignature` modifié côté `GitHubProvider`/`GitLabProvider` pour accepter les 2 secrets si old non expiré.
  - Cron quotidien (nouveau `apps/api/src/worker/jobs/purge-old-webhook-secrets.ts`) : `UPDATE apps SET webhook_secret_old=NULL WHERE webhook_secret_old_expires_at < now()`.
  - Audit log `action="webhook.secret.rotated"`.

**Validation Wave 3** : test manuel avec tunnel cloudflared sur un repo de fixture — check GitHub PR passe `pending → success`, UI deliveries affiche les rows.

---

### Wave 4 — Replay + tag push + notifications (2 j)

- **[//] 4.A — Replay endpoint**
  - `POST /apps/:id/webhook-deliveries/:deliveryId/replay` + `requireSecondFactor`.
  - Récupère `payload_raw`, décompresse, ré-exécute la pipeline handler (bypasse rate-limit mais pas les filtres).
  - Compte les replays : `SELECT count(*) FROM webhook_deliveries WHERE parent_delivery_id=?` ≥ 10 → 429.
  - Nouvelle delivery créée avec `parent_delivery_id` + `source="replay"` (nouvelle colonne enum `source ∈ {webhook, replay}`).

- **[//] 4.B — Tag push trigger**
  - `handlePushGeneric` détecte `ref.startsWith("refs/tags/")` → consulte `apps.deploy_on_tag` + `tag_pattern` (regex).
  - Si match : enqueue avec metadata `{ kind: "tag", tag: "v1.2.0" }`.
  - Worker deploy : en plus de push `:latest`, push `:<tag>` au registry.
  - Tests : fixture repo avec tag `v1.0.0` + pattern `v*`.

- **[//] 4.C — Notifications**
  - Nouveau schema `packages/db/src/schema/notification-channels.ts` (spec §3.1.1.12).
  - Module `apps/api/src/notify/index.ts` : `dispatcher(event, payload)` résout les channels matching et push.
  - 3 adapters : `discord.ts` (POST webhook JSON avec embeds riches), `slack.ts` (blocks), `email.ts` (nodemailer via `mailer.ts` existant).
  - UI `/settings/notifications` (nouvelle route `_authed/settings/notifications.tsx`) + par projet sous `_authed/apps/$id/settings/notifications.tsx`.
  - Bouton `Test` par channel → envoie un message canari.

**Validation Wave 4** : replay via UI → nouvelle delivery + build ; notif Discord réelle sur le webhook du `.claude/CLAUDE.md` (dev).

---

### ~~Wave 5 — PR previews~~ (HORS-SCOPE 3.1.1)

**Retirée du sprint** (décision 2026-04-21) : dépend du wildcard TLS sprint 4, et reste un différenciant "nice-to-have" vs une brique de parité critique.

Reportée dans un futur `docs/sprints/sprint-3.1.2-pr-previews.md` (ou fusionnée avec sprint 4 si on synchronise la livraison wildcard TLS + PR previews). Le flag `instance_settings.pr_previews_enabled` n'est **pas** créé dans ce sprint.

---

### Wave 6 — E2E + Runbook + DoD (1 j)

- **6.A — Script `scripts/test-webhook-e2e.sh`** : spawn cloudflared tunnel, enregistre webhook, fake un push via `gh api`, assert delivery DB + build success.
- **6.B — Playwright** : `apps/web/e2e/webhook/autodeploy.spec.ts` couvrant scénario démo §Deliverable (skip_path, skip_directive, happy path, coalescing 3 pushes, rotate secret).
- **6.C — Runbook** `docs/runbooks/webhook-autodeploy.md` : setup tunnel dev, debug delivery (`psql` query + logs pino), rotate secret, activer preview.
- **6.D — Cleanup** : purge containers e2e en fin de run (cf. `.claude/rules/testing.md` section cleanup).
- **6.E — DoD check** : cocher chaque case de `sprint-3.1.1-webhook-autodeploy.md` avec preuve concrète (commit hash, test vert, screenshot).

---

## Dépendances & ordre

```
Wave 1 (fondations)
   │
   └─▶ Wave 2 (logique handler)
          │
          └─▶ Wave 3 (UI + commit status)
                 │
                 └─▶ Wave 4 (replay + tag + notifs)
                        │
                        └─▶ Wave 6 (e2e + runbook + DoD)
```

- Wave 2 ne bloque pas Wave 3 sur la partie UI pure (3.B, 3.C) — ces items peuvent démarrer en parallèle dès W1 mergée. Seul 3.A (commit status hook dans le worker) attend 2.D (classifier transient/fatal).
- Wave 4 dépend de Wave 2 (replay rejoue la pipeline) et Wave 3 (modal UI + button Redeliver).

---

## Budget

| Wave | Estimation | Dépendance critique |
|---|---|---|
| 1 — Fondations | 2 j | — |
| 2 — Logique handler + suppression dette `jobs` | 3 j | W1 |
| 3 — Commit status + UI deliveries + rotation secret | 2 j | W1, W2 (pour 3.A) |
| 4 — Replay + tag push + notifications | 2 j | W2, W3 |
| ~~5~~ | ~~retirée~~ | — |
| 6 — E2E + runbook + DoD | 1 j | Toutes |
| **Total** | **10 j ouvrés** | ~2 semaines |

---

## Risques spécifiques

| Risque | Plan |
|---|---|
| `requireSecondFactor` nouveau → surface d'attaque | Tests de sécurité obligatoires avant merge wave 1.C : replay TOTP codes, brute-force, session fixation. Spec CSRF maintenue. |
| `payload_raw bytea` explose la DB | Cron wave 6 : purge `payload_raw_expires_at < now()`, métrique taille table dans dashboard admin. Cap 1 MB par row. |
| Coalescing drop un build utile | `decision=coalesced` toujours loggé, audit visible UI. Option per-app `coalesce_pushes=false` pour opt-out. |
| Double-enqueue Postgres `jobs` + BullMQ | Audit 2.F — supprimer la dette maintenant ou ouvrir ADR si bloqué. |
| Commit status quota GitHub (1000/h) | Dedup cache Redis 60 s + batch sur retries. Métrique compteur dans dashboard. |
| Rate-limit Redis key explosion | TTL 2 min sur les ZSET + `ZREMRANGEBYSCORE` à chaque check. |
| Rotation secret casse intégrations CI | Overlap 24 h documenté + notif email user à la rotation (wave 4.C). |

---

## Checklist avant de démarrer

- [x] Relire `docs/sprints/sprint-3.1.1-webhook-autodeploy.md` § Scope + DoD.
- [x] Relire `.claude/rules/{db,auth,testing,commits}.md`.
- [x] Budget : one-shot ~10 j, Waves 1→4+6, pas de split a/b (décision 2026-04-21).
- [x] Dette double-enqueue : supprimée dans wave 2.F (décision 2026-04-21).
- [x] PR previews : hors-scope, reportées dans un sprint futur (décision 2026-04-21).
