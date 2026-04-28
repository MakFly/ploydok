# Runbook — Webhook auto-deploy (Sprint 3.1.1)

Ce runbook couvre le cycle de vie complet des webhooks push/tag → build automatique : setup local, diagnostic, rotation secret, replay, notifications et commit status.

---

## 1. Setup local

### Prérequis

```bash
make infra-up   # postgres + redis + caddy + buildkitd + registry
make dev        # API :3335 + Web :5173
```

### Exposer l'API publiquement (tunnel)

Le provider (GitHub / GitLab) doit pouvoir joindre votre API en HTTPS. En dev, utilisez un tunnel :

```bash
cloudflared tunnel --url http://localhost:3335
# → affiche https://<hash>.trycloudflare.com — copier cette URL
```

Alternative : `ngrok http 3335`.

### Configurer le webhook côté provider

**GitHub App** :
- `Settings → Developer settings → GitHub Apps → <votre app> → Webhook URL`
- Valeur : `https://<tunnel>/github/webhook`
- Secret : généré par Ploydok, visible dans `/apps/$id/settings/webhook-secret`

**GitLab** :
- `Settings → Webhooks` sur le projet
- URL : `https://<tunnel>/gitlab/webhook`
- Secret token : valeur de `apps.webhook_secret` (affiché à la création ou après rotation)
- Cocher : `Push events`, `Tag push events`

---

## 2. Vérifier qu'un push déclenche un build

Pousser un commit vide :

```bash
git commit --allow-empty -m "test webhook" && git push
```

**Vérification côté UI** : `/apps/$id/settings/webhooks` → la dernière ligne affiche `decision=enqueued`.

**Vérification SQL directe** :

```bash
docker exec -it ploydok-postgres psql -U ploydok -d ploydok
```

```sql
SELECT id, decision, decision_reason, received_at
FROM webhook_deliveries
WHERE app_id = '<appId>'
ORDER BY received_at DESC
LIMIT 20;
```

**Valeurs possibles de `decision`** :

| Valeur | Sens |
|---|---|
| `enqueued` | Build déclenché (job BullMQ créé) |
| `coalesced` | Delivery absorbée par un push plus récent |
| `skipped_disabled` | L'app a le déploiement auto désactivé |
| `skipped_branch` | Filtre branch ne matche pas |
| `skipped_path` | Filtre watch_paths : aucun fichier modifié ne matche |
| `skipped_directive` | Commit message contient `[skip deploy]` ou `[skip ci]` |
| `skipped_unknown_app` | Aucune app ne correspond au `repo_full_name` du payload |
| `skipped_tag_disabled` | Push de tag mais `deploy_on_tag=false` |
| `skipped_tag_pattern` | Le tag ne matche pas `tag_pattern` |
| `invalid_signature` | HMAC invalide — problème de secret |
| `error` | Erreur interne pendant le traitement |
| `retried` | Replay d'une delivery originale |

---

## 3. Debug — delivery qui n'arrive pas

**Étape 1** : côté provider

- GitHub : `Settings → Developer settings → GitHub Apps → <app> → Recent Deliveries` — vérifier le status HTTP de la réponse Ploydok.
- GitLab : `Settings → Webhooks → Edit → Recent events`.

Si le provider reçoit un **401** : problème de signature (voir §3.2).
Si le provider reçoit un **429** : rate-limit atteint (voir §3.3).
Si le provider reçoit un **200** mais aucune delivery en DB : tail les logs pino.

**Étape 2** : vérifier la signature

```sql
SELECT webhook_secret, webhook_secret_old, webhook_secret_old_expires_at
FROM apps
WHERE id = '<appId>';
```

Le secret actif doit correspondre au secret configuré côté provider. Si `webhook_secret_old` est non-null et que l'overlap 24 h n'est pas expiré, les deux sont acceptés.

**Étape 3** : vérifier le rate-limit Redis

```bash
docker exec -it ploydok-redis redis-cli
```

```
# GitHub
ZCARD rl:webhook:github:<installation_id>

# GitLab
ZCARD rl:webhook:gitlab:<webhook_uuid>
```

Limite : 100 req/min par installation. La clé expire automatiquement après 2 × la fenêtre (120 s).

**Étape 4** : si `decision=skipped_*`

C'est intentionnel — les filtres fonctionnent. Lire `decision_reason` dans la row pour le détail exact.

---

## 4. Debug — delivery coalesced

Cas : 3 pushes rapides → 1 seul build.

Les 2 premières deliveries auront `decision=coalesced`. Les logs pino contiennent :

```json
{ "event": "webhook.coalesced", "app_id": "...", "dropped_job_id": "...", "reason": "newer push supersedes" }
```

Pour désactiver le coalescing sur une app spécifique :
- UI : `/apps/$id/settings/` → toggle `Coalesce pushes` → off
- Colonne DB : `apps.coalesce_pushes = false`

Sources : `apps/api/src/webhook-handlers/push.ts` (lignes 201–220).

---

## 5. Rotation du secret webhook

**Via UI** : `/apps/$id/settings/webhook-secret` → bouton **Rotate** (TOTP requis).

**Comportement** :
1. Nouveau secret généré → stocké dans `apps.webhook_secret`.
2. Ancien secret conservé 24 h dans `apps.webhook_secret_old` avec `apps.webhook_secret_old_expires_at`.
3. Pendant l'overlap, les **deux** signatures sont acceptées → zéro downtime.
4. Cron `purge-old-webhook-secrets` tourne à **03:00 UTC** chaque nuit et nullifie les anciens secrets expirés.

Source du cron : `apps/api/src/worker/jobs/purge-old-webhook-secrets.ts`.

**Après rotation** : mettre à jour le secret côté provider dans les 24 h.

**Rollback** : impossible. Régénérer et mettre à jour immédiatement le provider.

---

## 6. Replay d'une delivery

**Via UI** : table deliveries (`/apps/$id/settings/webhooks`) → bouton **⟲** sur une row → saisie TOTP → confirmation.

**Ce qui se passe** :
- Nouvelle row créée avec `source=replay` et `parent_delivery_id` pointant sur l'originale.
- Un build est déclenché si les filtres passent.

**Limites** :
- Max **10 replays** par delivery parente. Au-delà → 429.
- Vérifier dans SQL : `SELECT retry_count FROM webhook_deliveries WHERE id = '<id>'`.

**Use-case typique** : build échoué pour une raison transitoire (registry down, agent inaccessible).

---

## 7. Tag push trigger

**Activation** : `/apps/$id/settings/` → toggle **Deploy on tag push** + optionnellement un regex `Tag pattern` (ex: `^v\d+\.\d+\.\d+$`).

**Flow** :

```bash
git tag v1.0.0 && git push origin v1.0.0
```

→ build → image taggée `:<commitSha>` ET `:<tagName>` dans le registry local.

**Decisions associées** :
- `skipped_tag_disabled` : toggle off
- `skipped_tag_pattern` : tag présent mais ne matche pas le regex
- `enqueued` : trigger activé et tag valide

---

## 8. Notifications

**Configuration** :
- Scope user (toutes les apps) : `/settings/notifications`
- Scope app (une seule app) : `/apps/$id/settings/notifications`

**Providers opérationnels** : Discord, Slack, Telegram, Email.
**WhatsApp** : stub `coming_soon` — pas fonctionnel.

**Bouton Test** : envoie un canari immédiat sur le channel. Toast succès/échec avec la raison API.

**Scopes** :
- Channel avec `project_id=NULL` → reçoit les events de **toutes** les apps du user.
- Channel avec `project_id=<id>` → events de cette app uniquement.

**Events supportés** :
`build.started`, `build.succeeded`, `build.failed`, `deploy.succeeded`, `deploy.failed`, `webhook.rotated`.

---

## 9. Commit status callback

**GitHub** : status `ploydok/build` apparaît sur la PR et les commits.
- `pending` en début de build → `success` ou `failure` à la fin.
- Lien `target_url` → `/apps/$id/builds/$buildId/logs`.

**GitLab** : comportement équivalent sur le pipeline MR.

**Désactiver** : `/apps/$id/settings/` → toggle **Post commit status** → off (ou `apps.post_commit_status = false` en DB).

Source : `apps/api/src/providers/commit-status.ts`.

---

## 10. Erreurs fréquentes

| Symptôme | Cause probable | Fix |
|---|---|---|
| 401 persistant sur `/github/webhook` | Secret mismatch | Rotate via UI et mettre à jour côté provider |
| 401 persistant sur `/gitlab/webhook` | Secret token incorrect | Vérifier `apps.webhook_secret` en DB, update côté GitLab |
| `skipped_unknown_app` sur une app wired | `repo_full_name` différent entre `apps` et le payload | `PATCH /apps/:id` avec la bonne valeur `repo_full_name` |
| 429 sur l'endpoint webhook | Rate-limit 100 req/min/installation atteint | Attendre la fenêtre de 60 s. Clé Redis : `rl:webhook:github:<install_id>` |
| Delivery `enqueued` mais aucun build ne démarre | Worker BullMQ down | Vérifier que `make dev` tourne, chercher `deploy queue` dans les logs |
| Replay 429 | 10 replays déjà consommés pour cette delivery | Créer un nouveau push pour déclencher un nouveau build |
| Notif Discord configurée mais rien n'arrive | Webhook URL révoquée par Discord | Régénérer le webhook Discord, mettre à jour le channel dans Ploydok |
| `skipped_path` inattendu | Filtre `watch_paths` trop restrictif | Relire la config dans `/apps/$id/settings/` — vérifier les globs |
| `skipped_directive` inattendu | `[skip deploy]` ou `[skip ci]` dans le message de commit | Comportement normal — retirer la directive du commit |
