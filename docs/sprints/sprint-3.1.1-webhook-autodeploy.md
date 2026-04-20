# Sprint 3.1.1 — Webhook Auto-Deploy (push → live) ⏳ À faire

> **Statut : À FAIRE** — écrit 2026-04-20 après audit.
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

- [ ] Colonne `apps.auto_deploy_enabled boolean default true`.
- [ ] Toggle `/apps/:id/settings` → `AutoDeploySwitch.tsx` avec label « Redéployer automatiquement à chaque push sur `<branche>` ».
- [ ] Webhook handler respecte le flag : si `false` → enregistre la delivery en audit mais skip enqueue.
- [ ] Test : push sur app avec toggle `off` → pas de build créé, delivery loggée `skipped_disabled`.

### 3.1.1.2 — Branch + path + skip-directive filters

- [ ] Filtre branche : `apps.branch` stricte. Push sur autre branche = delivery `skipped_branch`.
- [ ] Filtre `watch_paths` (champ existant `apps.watch_paths text[]`) : si liste non-vide, parser `payload.commits[].{added,modified,removed}` et ignorer si **aucun fichier touché ne matche** un glob dans la liste.
- [ ] Glob matching côté worker/handler via `micromatch` (ou équivalent Bun-natif — vérifier `Bun.glob`). Tests unitaires obligatoires : `apps/*` matche `apps/web/src/foo.ts`.
- [ ] Directive commit message : si `[skip deploy]`, `[skip ci]` ou `[no deploy]` présent dans le **dernier commit du push** → delivery `skipped_directive`, pas d'enqueue.
- [ ] Tests : 3 scénarios (branch wrong, no-match path, skip-ci).

### 3.1.1.3 — Webhook deliveries audit log (core feature Dokploy/Coolify)

- [ ] Nouvelle table `webhook_deliveries` :
  - `id text pk`
  - `app_id text fk apps.id` (nullable si on ne sait pas résoudre l'app → delivery orpheline)
  - `provider text enum('github','gitlab')`
  - `delivery_external_id text` (GitHub `X-GitHub-Delivery`, GitLab `X-Gitlab-Event-UUID`)
  - `event text` (`push`, `ping`, `pull_request`…)
  - `ref text` (branche complète ex `refs/heads/main`)
  - `commit_sha text`
  - `commit_message text`
  - `signature_valid boolean`
  - `decision text enum('enqueued','skipped_disabled','skipped_branch','skipped_path','skipped_directive','skipped_unknown_app','invalid_signature','error')`
  - `decision_reason text` (message humain)
  - `build_id text fk builds.id nullable`
  - `payload_hash text` (SHA-256 du raw body, pour dedup — pas le payload complet pour éviter le poids)
  - `payload_sample jsonb` (les 2 premiers commits + meta repo — truncate à 4 KB max)
  - `received_at timestamptz`
  - `processed_at timestamptz`
  - index composite `(app_id, received_at desc)` pour lister efficacement par app
- [ ] Route `GET /apps/:id/webhook-deliveries?limit=50&cursor=…` (auth + ownership, pas de 2FA required pour lecture).
- [ ] UI `/apps/$id/settings` → nouvel onglet **Webhooks** → table `DataTable` réutilisable avec colonnes : time · event · branch · commit · decision badge · lien « replay ».
- [ ] Clic sur une row → modal « Delivery details » : payload JSON formaté, signature status, build lié (lien), bouton **Redeliver**.

### 3.1.1.4 — Manual redeliver / replay

- [ ] Endpoint `POST /apps/:id/webhook-deliveries/:deliveryId/replay` (auth + ownership + **requireSecondFactor**).
- [ ] Ré-exécute le handler sur le payload stocké (donc nécessite payload complet, pas juste le hash — ajouter `payload_raw bytea` en DB, TTL 30 j, puis purge).
- [ ] Enforcement : max 10 replays par delivery (anti-abus), erreur 429 sinon.
- [ ] Audit : la nouvelle delivery créée référence la parent via `parent_delivery_id`.
- [ ] Test e2e : corrompre le build d'origine, replay → nouveau build propre.

### 3.1.1.5 — Commit status callback (match GitHub/GitLab UI)

- [ ] GitHub : `POST /repos/:owner/:repo/statuses/:sha` avec `context: "ploydok/build"`, `state: pending|success|failure|error`, `target_url` pointant sur `/apps/:id/builds/:buildId/logs`, `description: "Build #42 — 1m23s"`.
- [ ] GitLab : équivalent `POST /projects/:id/statuses/:sha`.
- [ ] Hooks dans `runBlueGreen` :
  - `build.started` → `pending`
  - `build.succeeded` → `success`
  - `build.failed` → `failure`
  - exception non-liée au build → `error`
- [ ] Token auth : GitHub App installation token (déjà en place, cache 55 min) / GitLab user token.
- [ ] Opt-in par app : `apps.post_commit_status boolean default true`.
- [ ] Test : repo public, push → au statut vert dans la PR, click → logs Ploydok.

### 3.1.1.6 — Coalescing (anti-storm)

- [ ] BullMQ jobId deterministic par `(app_id, branch)`. Si un job `deploy` pour la même app/branch est **waiting** en queue, le drop et garder seulement le nouveau (commit le plus récent gagne).
- [ ] Si job **active** (en cours de build) → laisser finir, puis prochain push crée un nouveau job avec le dernier commit observé depuis.
- [ ] Métrique : compteur `webhook.coalesced` + log info à chaque drop.
- [ ] Option per-app `apps.coalesce_pushes boolean default true` (désactivable si on veut garder historique de builds).
- [ ] Test : 3 pushes en < 2 s → 1 seul build sur le commit le plus récent.

### 3.1.1.7 — Rate limiting webhook ingress

- [ ] Sliding window Redis : 100 req/min/installation (GitHub) + 100 req/min/token (GitLab).
- [ ] Dépassement → 429, delivery loggée `error` avec reason `rate_limited`.
- [ ] Config globale `instance_settings.webhook_rate_limit_per_min` (default 100).
- [ ] Métrique exposée dashboard admin.

### 3.1.1.8 — Retry transient errors

- [ ] BullMQ queue `deploy` avec `attempts: 3, backoff: { type: 'exponential', delay: 5000 }`.
- [ ] **Attention** : retry automatique **uniquement** si l'erreur est classée transient. Erreurs build (Dockerfile invalide, Nixpacks fail) = **pas de retry** (échec définitif).
- [ ] Classification : wrapper error en `TransientDeployError` vs `FatalDeployError` dans `handlers/deploy.ts`.
- [ ] Delivery audit : `decision='retried'` + compteur `retry_count`.
- [ ] Test : mock agent socket down → 3 tentatives puis fail → fail marqué `retries_exhausted`.

### 3.1.1.9 — Rotation secret webhook

- [ ] UI `/apps/$id/settings/webhook` : afficher le secret masqué + bouton « Rotate ».
- [ ] Rotation : génère nouveau secret (`openssl rand -hex 32`), garde l'ancien valide pendant **24 h** (colonne `webhook_secret_old` + `webhook_secret_old_expires_at`). Les deux signatures acceptées pendant le chevauchement → zéro downtime webhook.
- [ ] Cron quotidien purge les secrets expirés.
- [ ] Audit : `audit_log` trace la rotation (qui, quand).
- [ ] Test : rotate, push avec ancien secret (24 h → ok), puis push après 24 h → rejeté.

### 3.1.1.10 — Tag push trigger (optionnel, opt-in)

- [ ] Filtre event : `apps.deploy_on_tag boolean default false`.
- [ ] Si activé : `refs/tags/*` déclenche build + tag l'image `<app_id>:<git_tag>` en plus de `:latest`.
- [ ] UI : option `Deploy on tag push` avec regex optionnel (`v*`, `release-*`).
- [ ] Use-case : release versionnée, immutable deploys.

### 3.1.1.11 — PR preview deploys (feature différenciante, gros scope — keep behind flag)

- [ ] Flag global `instance_settings.pr_previews_enabled`.
- [ ] Event `pull_request.opened/synchronize` → crée une **app éphémère** `<main_app_id>-pr-<pr_number>` sur le network projet, domaine `pr-<pr_number>.<app.domain>` (wildcard TLS du sprint 4).
- [ ] Event `pull_request.closed` → teardown (delete app + container + images registry + route Caddy).
- [ ] Commit status callback avec `target_url` → preview URL.
- [ ] Cost-guard : max 3 previews simultanées par app (config).
- [ ] UI `/apps/$id/previews` : liste des previews actives + bouton teardown manuel.

### 3.1.1.12 — Notifications (Discord / Slack / email)

- [ ] Table `notification_channels` (par user ou par project) : `kind enum('discord','slack','email')`, `target` (webhook URL ou email), `events text[]` (filter: `build.succeeded`, `build.failed`, `deploy.succeeded`, …).
- [ ] Dispatcher `notify(event, payload)` appelé depuis le worker.
- [ ] Templates markdown par kind (Discord embed riche, Slack blocks, email HTML).
- [ ] Test connexion au submit (envoie message test).
- [ ] UI `/settings/notifications` + par project override.

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

- [ ] `apps.auto_deploy_enabled`, `apps.post_commit_status`, `apps.coalesce_pushes`, `apps.deploy_on_tag` existent + UI togglables.
- [ ] Table `webhook_deliveries` + route + UI Deliveries fonctionnelle sur `/apps/$id/settings`.
- [ ] `watch_paths` glob matching testé (tests unitaires).
- [ ] Directive `[skip deploy]` / `[skip ci]` respectée.
- [ ] Replay endpoint protégé par 2FA + anti-abus 10× max.
- [ ] Commit status callback vert dans PR GitHub + GitLab (screenshot dans runbook).
- [ ] Coalescing validé : 3 pushes rapprochés = 1 build (test e2e).
- [ ] Rate-limit 100 req/min/installation enforced et testé.
- [ ] Rotation secret sans downtime (chevauchement 24 h validé par test).
- [ ] Retry transient classifier opérationnel (test mock agent down → 3 tentatives).
- [ ] Tag push opt-in fonctionnel (test sur repo de fixture).
- [ ] PR preview derrière flag, avec teardown auto + cap 3 simultanées.
- [ ] Notifications Discord + Slack + email, opt-in par channel + événement.
- [ ] `scripts/test-webhook-e2e.sh` + spec Playwright `apps/web/e2e/webhook/*.spec.ts` couvrent le scénario démo bout-en-bout.
- [ ] Runbook `docs/runbooks/webhook-autodeploy.md` : comment brancher un tunnel public (cloudflared), debug une delivery, rotate un secret, activer preview.
- [ ] `bun run typecheck && bun run lint && bun test && bun run check:spdx` verts.

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
