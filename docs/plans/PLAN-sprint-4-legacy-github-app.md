# PLAN — Sprint 4 : Dokploy-style UX + GitHub App

## Audit de l'état actuel (2026-04-16)

### Bugs critiques P0

**P0.1 — `GET /apps` → 404**
Les routers `apps`, `github`, `ws` existent (fichiers `apps/api/src/routes/*.ts`) mais ne sont **jamais montés** dans `apps/api/src/app.ts`. Seuls `auth` et `debug` sont branchés via `app.route(...)`. Conséquence : toutes les pages qui consomment l'API apps renvoient 404. Les tests passent parce qu'ils montent les routers isolément. Régression M1.4/M2.x.

**P0.2 — Dashboard vide**
`apps/web/src/routes/dashboard.tsx` est un placeholder : juste un `<h1>Welcome</h1>` + `"Projects and apps will appear here"`. Aucune data branchée.

**P0.3 — Erreurs UX brutales**
Les pages affichent du texte brut `"Failed to load apps: Route introuvable"` quand l'API répond 404. Pas d'ErrorBoundary TanStack, pas de composant UI dédié.

### Désalignement d'archi vs Dokploy / Coolify

**P1.1 — OAuth App au lieu de GitHub App**
Flow actuel : user doit créer manuellement une OAuth App sur github.com/settings/developers, copier Client ID + Secret dans `.env.local`, gérer le callback URL. **Friction énorme pour onboarding**.

Dokploy et Coolify utilisent le **GitHub App Manifest flow** : 1 clic "Create GitHub App" dans l'UI → POST d'un manifest à `github.com/settings/apps/new?state=X` → GitHub crée l'App + renvoie un `code` temporaire → échange contre `app_id/private_key/webhook_secret` → stockage en keyring → installable sur comptes/orgs avec choix granulaire des repos → webhooks auto-provisionnés au niveau App (pas par repo).

---

## Sprint 4 proposé

### Wave 1 — Fixes P0 (1-2h, parallélisable)

| # | Milestone | Files owned |
|---|-----------|-------------|
| **S4.1.1** | Mount `apps`/`github`/`ws` routers dans `app.ts` | `apps/api/src/app.ts` |
| **S4.1.2** | `<ApiErrorState />` + ErrorBoundary TanStack | `apps/web/src/components/errors/*`, `routes/__root.tsx` |
| **S4.1.3** | Dashboard peuplé : Apps grid + Recent builds + Quick actions | `routes/dashboard.tsx`, widgets |

### Wave 2 — Migration GitHub App (4-6h, séquentielle)

| # | Milestone | Détails |
|---|-----------|---------|
| **S4.2.1** | GitHub App Manifest flow | Bouton "Create GitHub App" → POST `/github/app/manifest` côté API renvoie `{ manifest, state }` → front soumet un `<form>` auto-submitted vers `github.com/settings/apps/new?state=X` → callback `/github/app/callback?code=X` échange `code` contre credentials → store keyring |
| **S4.2.2** | Installation tokens backend | Remplace access tokens OAuth par JWT RS256 signé avec la private key App (10min TTL) → `POST /app/installations/{id}/access_tokens` → token 1h → cache Redis-like in-mem |
| **S4.2.3** | Webhooks auto-provisionnés | Manifest déclare `default_events: [push, pull_request]` → 1 seul endpoint `/github/webhook` reçoit tout → signature HMAC-SHA256 vérifiée via `X-Hub-Signature-256` → dispatch vers handler selon `X-GitHub-Event` |
| **S4.2.4** | Migration path | Drop env vars `GITHUB_CLIENT_ID/SECRET/CALLBACK_URL` → credentials en DB encrypted (keyring) |

### Wave 3 — Dashboard Dokploy-style (3-4h, optionnel sprint 5)

| # | Milestone |
|---|-----------|
| **S4.3.1** | Projects hierarchy : 1 project → N services (app, postgres, redis...) |
| **S4.3.2** | Auto-redeploy on push (webhook push → enqueue `deploy.requested`) |
| **S4.3.3** | Env variables UI (add/edit/import `.env` file) |
| **S4.3.4** | Metrics sidebar (CPU/RAM/logs temps réel via WS) |

---

## Definition of Done sprint 4

- [ ] `GET /apps`, `/github/*`, `/ws/*` répondent correctement (non plus 404)
- [ ] Dashboard montre liste d'apps + 5 derniers builds + stats
- [ ] Erreurs API affichées via composant UI (jamais texte brut)
- [ ] Plus aucune variable GitHub à toucher manuellement dans `.env.local`
- [ ] User clique "Install GitHub App" → onboarding complet en < 1min
- [ ] Push sur repo connecté déclenche un redeploy auto
- [ ] `bun typecheck` + `bun run test` verts
- [ ] Runbook mis à jour `docs/runbooks/github-app-setup.md`

---

## Références externes

- [GitHub App Manifest flow docs](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)
- Dokploy git provider integration : `dokploy/dokploy` repo, dossier `apps/dokploy/server/utils/providers/github`
- Coolify : `coollabsio/coolify`, endpoints `/api/v1/sources/github`
