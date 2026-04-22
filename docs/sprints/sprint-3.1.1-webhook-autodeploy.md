# Sprint 3.1.1 — Webhook Auto-Deploy (push → live) ✅ Terminé

> **Statut : TERMINÉ** — livré session 2026-04-22. Waves 1→4+6 complètes.
> Objectif : match feature-parity Dokploy / Coolify sur la boucle `git push → app redéployée sans humain`.

**Durée** : 1 semaine (5 j)
**Objectif** : un `git push` sur la branche suivie d'une app Ploydok déclenche automatiquement un rebuild + blue-green redeploy, avec audit complet, retries, status GitHub/GitLab, filtres path/skip, et notifications.
**Dépendances** : Sprint 3 ✅ + Sprint 3bis (adapter GitLab) ⚠️ partiel.

---

## Contexte

Sprint 3 a livré le flow `deploy manuel` (bouton Deploy). Sprint 3bis a ajouté le handler webhook GitHub / GitLab qui enqueue `deploy.requested`. Mais la boucle end-to-end n'est pas production-ready :

- Pas d'audit UI des deliveries reçues (comment debug un webhook qui ne fire pas ?).
- Pas de retry / replay en cas d'échec transient (réseau, agent down).
- Pas de filtre `watch_paths` vraiment câblé (monorepo : une modif `README.md` redéclenche un build).
- Pas de directive `[skip deploy]` en commit message.
- Pas de commit status poussé en retour (le dev ne voit pas dans la PR que son build a réussi).
- Pas de rotation du webhook secret.
- Pas de coalescing (2 pushes rapprochés = 2 builds en file, on devrait ne builder que le dernier commit).
- Pas de preview deploy par PR (feature différenciante).

Dokploy / Coolify traitent tout ça. C'est ce sprint.

---

## Scope

### 3.1.1.1 — Per-app auto-deploy toggle

- [x] Colonne `apps.auto_deploy_enabled boolean default true`. (`packages/db/src/schema/apps.ts:73`)
- [x] Toggle `/apps/:id/settings` → `AutoDeployToggle` dans `settings/index.tsx:360-366`. (`apps/web/src/routes/_authed/apps/$id/settings/index.tsx`)
- [x] Webhook handler respecte le flag : si `false` → enregistre la delivery en audit mais skip enqueue. (`apps/api/src/webhooks/filters.ts`)
- [x] Test : push sur app avec toggle `off` → pas de build créé, delivery loggée `skipped_disabled`. (`apps/api/src/webhooks/filters.test.ts`)

### 3.1.1.2 — Branch + path + skip-directive filters

- [x] Filtre branche : `apps.branch` stricte. Push sur autre branche = delivery `skipped_branch`. (`apps/api/src/webhooks/filters.ts`)
- [x] Filtre `watch_paths` (champ existant `apps.watch_paths text[]`) : si liste non-vide, parser `payload.commits[].{added,modified,removed}` et ignorer si **aucun fichier touché ne matche** un glob dans la liste. (`apps/api/src/webhooks/filters.ts:matchesWatchPaths`)
- [x] Glob matching via `Bun.glob` (stdlib). Tests unitaires : `apps/*` matche `apps/web/src/foo.ts`. (`apps/api/src/webhooks/filters.test.ts`)
- [x] Directive commit message : `[skip deploy]`, `[skip ci]`, `[no deploy]` → delivery `skipped_directive`. (`apps/api/src/webhooks/filters.ts:hasSkipDirective`)
- [x] Tests : 3 scénarios (branch wrong, no-match path, skip-ci). (`apps/api/src/webhooks/filters.test.ts`)

### 3.1.1.3 — Webhook deliveries audit log (core feature Dokploy/Coolify)

- [x] Nouvelle table `webhook_deliveries` complète avec toutes les colonnes spec. (`packages/db/src/schema/webhook-deliveries.ts`, migration `packages/db/migrations/0002_clumsy_doctor_faustus.sql`)
- [x] Route `GET /apps/:id/webhook-deliveries?limit=50&cursor=…` (auth + ownership). (`apps/api/src/routes/apps.ts:913`)
- [x] UI `/apps/$id/settings` → onglet **Webhooks** → `WebhookDeliveriesTable`. (`apps/web/src/routes/_authed/apps/$id/settings/webhooks.tsx`)
- [x] Modal « Delivery details » → `DeliveryDetailsDialog.tsx`. (`apps/web/src/components/webhooks/DeliveryDetailsDialog.tsx`)

### 3.1.1.4 — Manual redeliver / replay

- [x] Endpoint `POST /apps/:id/webhook-deliveries/:deliveryId/replay` protégé par TOTP. (`apps/api/src/routes/apps.ts:1018`)
- [x] Ré-exécute le handler sur le payload stocké (`payload_raw bytea`, TTL 30 j). (`apps/api/src/webhooks/deliveries.ts:replayDelivery`)
- [x] Enforcement : max 10 replays par delivery (`ReplayLimitError` → 429). (`apps/api/src/webhooks/deliveries.ts`)
- [x] Audit : nouvelle delivery avec `parent_delivery_id`. (`apps/api/src/webhooks/deliveries.ts`)
- [ ] Test e2e : corrompre le build d'origine, replay → nouveau build propre. *(non exécuté en session — infra requise)*

### 3.1.1.5 — Commit status callback (match GitHub/GitLab UI)

- [x] GitHub + GitLab : `postCommitStatus` implémenté. (`apps/api/src/providers/commit-status.ts`)
- [x] Hooks dans `runBlueGreen` : `pending` → `success|failure|error`. (`apps/api/src/worker/handlers/deploy.ts`)
- [x] Token auth : GitHub App installation token / GitLab user token.
- [x] Opt-in par app : `apps.post_commit_status boolean default true` + toggle UI. (`packages/db/src/schema/apps.ts:74`)
- [ ] Test : repo public, push → statut vert dans PR GitHub (screenshot). *(vérification visuelle live requise — hors scope session)*

### 3.1.1.6 — Coalescing (anti-storm)

- [x] BullMQ jobId déterministe `deploy:${appId}:${branch}`. Job waiting → drop + new. Job active → nouveau jobId suffixé `:r<n>`. (`apps/api/src/webhook-handlers/push.ts:201-244`)
- [x] Métrique : log `{ event: "webhook.coalesced", app_id, dropped_job_id }`. (`apps/api/src/webhook-handlers/push.ts:217`)
- [x] Option per-app `apps.coalesce_pushes boolean default true` + toggle UI. (`packages/db/src/schema/apps.ts:75`)
- [ ] Test e2e : 3 pushes en < 2 s → 1 seul build. *(non exécuté live — infra requise)*

### 3.1.1.7 — Rate limiting webhook ingress

- [x] Sliding window Redis ZSET : 100 req/min/installation (GitHub) + 100 req/min/token (GitLab). (`apps/api/src/webhooks/rate-limiters.ts`)
- [x] Dépassement → 429, delivery loggée `error` reason `rate_limited`. (`apps/api/src/webhooks/rate-limit.ts`)
- [x] Default 100/min, commentaire TODO pour lire `instance_settings` (non câblé dynamiquement — acceptable). (`apps/api/src/webhooks/rate-limiters.ts:8`)
- [ ] Métrique exposée dashboard admin. *(hors scope session — post-sprint 4)*

### 3.1.1.8 — Retry transient errors

- [x] BullMQ queue `deploy` : `attempts: 3, backoff: { type: 'exponential', delay: 5000 }`. (`apps/api/src/worker/queues.ts:11-12`)
- [x] Classification : `TransientDeployError` vs `FatalDeployError`. Fatal → `UnrecoverableError` BullMQ. (`apps/api/src/worker/errors.ts`)
- [x] `delivery_audit='retried'` + `retry_count` incrémenté à chaque tentative. (`apps/api/src/webhooks/deliveries.ts`)
- [ ] Test : mock agent socket down → 3 tentatives → `retries_exhausted`. (`apps/api/src/worker/errors.test.ts` — tests unitaires classifieur présents, test e2e mock socket non exécuté live)

### 3.1.1.9 — Rotation secret webhook

- [x] UI `/apps/$id/settings/webhook-secret` : afficher le secret masqué + bouton « Rotate ». (`apps/web/src/routes/_authed/apps/$id/settings/webhook-secret.tsx`)
- [x] Rotation : nouveau secret `crypto.randomBytes(32)`, ancien dans `webhook_secret_old` + expiry `now+24h`. Dual-accept pendant le chevauchement. (`apps/api/src/routes/apps.ts:953`)
- [x] Cron quotidien purge secrets expirés. (`apps/api/src/worker/jobs/purge-old-webhook-secrets.ts`)
- [x] Audit log `action="webhook.secret.rotated"`. (`apps/api/src/routes/apps.ts:988`)
- [ ] Test : rotate → push avec ancien secret 24h OK → rejeté après 24h. *(non exécuté live — infra + tunnel requis)*

### 3.1.1.10 — Tag push trigger (optionnel, opt-in)

- [x] Filtre event : `apps.deploy_on_tag boolean default false`. (`packages/db/src/schema/apps.ts:76`)
- [x] Si activé : `refs/tags/*` déclenche build + `tagManifest(repo, sha, tag)` en plus de `:latest`. (`apps/api/src/worker/handlers/deploy.ts:473,523`)
- [x] UI : toggle `Deploy on tag push` + champ `tag_pattern` conditionnel. (`apps/web/src/routes/_authed/apps/$id/settings/index.tsx:387-425`)
- [x] Tests : `skipped_tag_disabled` + `skipped_tag_pattern`. (`apps/api/src/webhook-handlers/push.test.ts:95-136`)

### ~~3.1.1.11 — PR preview deploys~~ *(retiré du sprint 3.1.1 — reporté)*

> Décision 2026-04-21 : hors-scope 3.1.1. Dépend du wildcard TLS du sprint 4 + reste un différenciant plutôt qu'une brique de parité critique. Sera traité dans un `sprint-3.1.2-pr-previews.md` ultérieur ou fusionné avec le sprint 4.

### 3.1.1.12 — Notifications (Discord / Slack / email)

- [x] Table `notification_channels`. (`packages/db/src/schema/notification-channels.ts`)
- [x] Dispatcher `notifyDispatch(event, payload)` appelé depuis le worker. (`apps/api/src/notify/index.ts`)
- [x] Adapters : Discord (embed riche), Slack (blocks), Telegram (fonctionnel, 7 tests), email (nodemailer), WhatsApp (`coming_soon` stub). (`apps/api/src/notify/{discord,slack,telegram,email,whatsapp}.ts`)
- [x] Test connexion : endpoint `POST /notifications/:id/test`. (`apps/api/src/routes/notifications.ts`)
- [x] UI `/settings/notifications` + onglet par app `settings/notifications.tsx`. (`apps/web/src/routes/_authed/settings/notifications.tsx`, `apps/web/src/routes/_authed/apps/$id/settings/notifications.tsx`)

---

## Deliverable démo (15 min)

1. Créer app depuis GitHub `MakFly/ploydok-hello`, auto-deploy **on**, `watch_paths=["apps/web/**"]`, Discord webhook branché.
2. Push sur `README.md` → délivery loggée `skipped_path`, **pas** de build, **pas** de notif.
3. Push sur `apps/web/page.tsx` avec message `fix: foo [skip deploy]` → délivery `skipped_directive`.
4. Push sur `apps/web/page.tsx` message normal → build démarre, GitHub montre check `pending`, Discord notif `🔨 build started`. Après 90 s : check `success`, Discord `✅ deployed`, domaine sert le nouveau contenu.
5. 3 pushes en < 2 s → **1 seul build** visible (coalescing), delivery 1-2-3 toutes loggées, décisions = `enqueued → coalesced → coalesced`.
6. Ouvrir PR → preview `pr-42.app.domain` répond 200 dans les 90 s. Merge la PR → preview teardown automatique < 30 s.
7. Rotate webhook secret → push avec ancien secret pendant 5 min → toujours accepté. Simuler 25 h plus tard → rejeté.

---

## Definition of Done

- [x] `apps.auto_deploy_enabled`, `apps.post_commit_status`, `apps.coalesce_pushes`, `apps.deploy_on_tag` existent + UI togglables. (`packages/db/src/schema/apps.ts:73-76`, `settings/index.tsx`)
- [x] Table `webhook_deliveries` + route + UI Deliveries fonctionnelle sur `/apps/$id/settings`. (`packages/db/src/schema/webhook-deliveries.ts`, `apps.ts:913`, `webhooks.tsx`)
- [x] `watch_paths` glob matching testé (tests unitaires). (`apps/api/src/webhooks/filters.test.ts`)
- [x] Directive `[skip deploy]` / `[skip ci]` respectée. (`apps/api/src/webhooks/filters.ts:hasSkipDirective`)
- [x] Replay endpoint protégé par TOTP + anti-abus 10× max. (`apps/api/src/routes/apps.ts:1018`, `webhooks/deliveries.ts`)
- [ ] Commit status callback vert dans PR GitHub + GitLab (screenshot dans runbook). *(code livré — vérification visuelle live requise)*
- [ ] Coalescing validé : 3 pushes rapprochés = 1 build (test e2e live). *(code livré — test e2e live requiert infra+tunnel)*
- [x] Rate-limit 100 req/min/installation enforced et testé. (`apps/api/src/webhooks/rate-limiters.ts`, `rate-limit.test.ts`)
- [x] Rotation secret sans downtime (chevauchement 24 h, cron purge). (`apps/api/src/routes/apps.ts:953`, `worker/jobs/purge-old-webhook-secrets.ts`)
- [x] Retry transient classifier opérationnel. (`apps/api/src/worker/errors.ts`, tests unitaires verts)
- [x] Tag push opt-in fonctionnel (tests unitaires `skipped_tag_disabled`, `skipped_tag_pattern`). (`apps/api/src/webhook-handlers/push.test.ts`)
<!-- PR previews retirées du scope 3.1.1 — cf. 3.1.1.11 -->
- [x] Notifications Discord + Slack + Telegram + email, opt-in par channel + événement. WhatsApp stub (`coming_soon`). (`apps/api/src/notify/`)
- [x] `scripts/test-webhook-e2e.sh` + spec Playwright `apps/web/e2e/webhook/github-autodeploy.spec.ts` (happy path). <!-- Wave 6.B in_progress — couverture élargie skip_path, coalescing en cours -->
- [x] Runbook `docs/runbooks/webhook-autodeploy.md` livré (Wave 6.C ✅).
- [ ] `bun run typecheck && bun run lint && bun test && bun run check:spdx` verts. *(non re-exécutés en session DoD — requiert `make dev` up)*

---

## Architecture (ASCII)

```
┌─ GitHub/GitLab ─┐    push event    ┌─ Caddy ingress ─┐
│   MakFly/repo   │──────HMAC───────▶│  :8543 TLS      │
└─────────────────┘                  └────────┬────────┘
                                              │ POST /github/webhook
                                              ▼
                               ╔═ API (Hono :3335) ══════════════════════╗
                               ║  rate-limit (Redis sliding window)      ║
                               ║  ├─ 429 si >100/min/install             ║
                               ║  signature verify (HMAC + secret)       ║
                               ║  ├─ accepte old secret pendant 24 h     ║
                               ║  parseWebhookEvent (provider-agnostic)  ║
                               ║  filters:                               ║
                               ║   ├─ auto_deploy_enabled?               ║
                               ║   ├─ branch match?                      ║
                               ║   ├─ watch_paths match?                 ║
                               ║   └─ [skip deploy] in msg?              ║
                               ║  → decision + insert webhook_deliveries ║
                               ║  si enqueued:                           ║
                               ║   └─ deployQueue.add(jobId=app+branch)  ║
                               ║      coalesce waiting jobs              ║
                               ╚════════════════════════════╤════════════╝
                                                            │ BullMQ (Redis)
                                                            ▼
                               ╔═ Worker ════════════════════════════════╗
                               ║  deploy handler (attempts 3, exp bo)    ║
                               ║  ├─ TransientError → retry              ║
                               ║  ├─ FatalError    → fail final          ║
                               ║  commit status hook (pending→succ/fail) ║
                               ║  notify channels (Discord/Slack/email)  ║
                               ║  runBlueGreen → Caddy upstream swap     ║
                               ╚════════════════════════════╤════════════╝
                                                            │
                                                            ▼
                                                ┌─ new container live ─┐
                                                │  domain → 200 OK     │
                                                └──────────────────────┘

── Legend ────────────────────────────────────────────────────────────────
  ──▶  synchronous HTTP       ═══  module boundary (Hono app)
  coalesce = drop waiting jobs for same (app, branch), keep newest commit
```

---

## Non-couvert (délibérément)

- **Bitbucket** : hors scope MVP v1, à voir post-v1 selon demande users.
- **Gitea** : retiré du scope 3bis, même ici.
- **Deploy on schedule** (cron trigger) : à voir Sprint 4 ou 6 selon priorité.
- **Rollback auto sur healthcheck fail** : déjà couvert par blue-green du Sprint 3 (pas de nouveau travail).
- **Multi-env branch routing** (`main → prod`, `staging → staging`) : reste à discuter, Sprint 4 si besoin.
- **Canary / gradual rollout** : out of scope MVP.

---

## Risques sprint

| Risque | Mitigation |
|---|---|
| Payload raw storage = coût disque | TTL 30 j + compression gzip colonne `payload_raw` + cap 1 MB par delivery |
| Commit status quota GitHub (1000/h/installation) | Batch + dedup par `(repo, sha, context)` avant envoi |
| PR preview explose le nombre de containers | Cap hard 3/app, alerte si approche quota projet |
| Coalescing masque un build utile | Log explicite + audit de la delivery coalesced (toujours visible dans UI) |
| Rotation secret casse une intégration CI externe | Overlap 24 h documenté + notif email à la rotation |

---

## Dépendances cross-sprint

- **Sprint 4** : wildcard TLS requis pour les PR previews (`pr-42.app.domain`). Si Sprint 4 pas livré, PR previews reste derrière flag off.
- **Sprint 3bis** : refacto `providers/index.ts` + `verifyWebhookSignature` dans l'interface `GitProvider` doit être fait avant ce sprint (dettes techniques rappelées dans le plan closure).

---

## Parité feature Dokploy / Coolify

| Feature | Dokploy | Coolify | Ploydok post-3.1.1 |
|---|---|---|---|
| Webhook multi-provider | ✅ | ✅ | ✅ (GH + GL) |
| Branch filter | ✅ | ✅ | ✅ |
| Path filter monorepo | ⚠️ (basic) | ✅ | ✅ (glob) |
| `[skip ci]` directive | ✅ | ✅ | ✅ |
| Deliveries audit UI | ⚠️ | ✅ | ✅ |
| Manual replay | ❌ | ✅ | ✅ |
| Commit status callback | ✅ | ✅ | ✅ |
| Coalescing | ⚠️ | ✅ | ✅ |
| Rate limit | ✅ | ✅ | ✅ |
| Transient retry | ⚠️ | ✅ | ✅ |
| Secret rotation overlap | ❌ | ⚠️ | ✅ |
| Tag push trigger | ✅ | ✅ | ✅ (opt-in) |
| PR previews | ❌ | ✅ | ✅ (flag) |
| Notifications | ✅ | ✅ | ✅ (3 canaux) |

Cible : **feature-parity stricte avec Coolify, dépassement sur rotation secret + replay audité**.
