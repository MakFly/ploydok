# PLAN — Refonte app-detail `/apps/$id/*`

> Base research : `docs/research/RESEARCH-app-detail-refonte.md`
> Objectif : refonte UX/UI + logique inspirée de Dokploy et Coolify.
> Date : 2026-04-17

## Principes d'exécution

- **Ownership strict par milestone** : zero overlap de fichiers dans une même wave.
- **Fichiers générés** (`routeTree.gen.ts`) : jamais édités à la main.
- **Contraintes run-time** :
  - `ig "pattern"` pour chercher, `bun` / `bunx` pour JS/TS.
  - **Ne pas** lancer `make dev`, `bun run dev`, `bun run --watch`. One-shots autorisés : `bun test`, `bunx tsc --noEmit`, `bun run lint`.
  - SPDX header sur tout nouveau `.ts(x)` : `// SPDX-License-Identifier: AGPL-3.0-only`.
  - `healthcheck.{intervalS, timeoutS, retries, startPeriodS}` doivent être pris en charge (ne pas régresser — fix silencieux attendu).
- **Tests** : chaque milestone ajoute/met à jour au moins un test pertinent avant "done".
- **Définition de "done" par milestone** : typecheck vert + tests ciblés verts + lint vert + démo (description écrite + screenshot optionnel) dans le rapport final de l'agent.

---

## Wave 1 — Foundations (P0) — SÉQUENTIEL (1 agent)

**Pourquoi un seul agent ?** Toutes les tâches refondent le header et le data-layer côté hooks — elles partagent `$id.tsx` et `lib/apps.ts`.

### Milestone 1.0 — Foundation refactor + header v2 + Deploy/Actions SSE-aware

**Owner exclusif :**

**Modifie :**
- `apps/web/src/routes/_authed/apps/$id.tsx` (extrait le header, utilise le nouveau composant, split hooks)
- `apps/web/src/lib/apps.ts` (extraction des mutations vers `apps-mutations.ts`, reste = types + queries)

**Crée :**
- `apps/web/src/lib/apps-mutations.ts` (useDeployApp, useRollbackApp, useStopApp, useRestartApp, useUpdateAppSettings, useRegistryGc)
- `apps/web/src/lib/hooks/use-active-build.ts` (dérive l'état "un build est en cours pour cette app" via SSE : `build.started`/`build.succeeded`/`build.failed` + status `currentApp.status === 'building'`)
- `apps/web/src/components/apps/AppHeader.tsx` (header sticky complet : breadcrumb, nom, status badge animé, URL, Deploy split-button, Actions menu)
- `apps/web/src/components/apps/DeployButton.tsx` (shadcn split-button : primary = Deploy, dropdown = Redeploy / Rebuild without cache ; affiche "Deploying…" avec spinner tant que `useActiveBuild` est true)
- `apps/web/src/components/apps/ActionsMenu.tsx` (shadcn `DropdownMenu` : Stop / Restart / Rollback / Delete — chacun ouvre un `AlertDialog`)
- `apps/web/src/components/apps/AppStatusBadge.tsx` **(déjà existant, à mettre à jour)** : pulse animé quand `building` ou `deploying`
- Tests : `apps/web/src/components/apps/AppHeader.test.tsx`, `use-active-build.test.ts`, `apps-mutations.test.ts`

**Tâches concrètes :**
1. Splitter `lib/apps.ts` : les types + `useApp` + `useBuilds` restent, toutes les mutations vont dans `lib/apps-mutations.ts`. Mettre à jour TOUS les imports (builds.tsx, settings.tsx, overview.tsx, etc.).
2. Créer `useActiveBuild(appId)` : retourne `{ isActive: boolean, buildId?: string, status: BuildStatus }` basé sur le SSE du `events-provider`. Logic : écoute `build.started` → true, `build.succeeded|failed` → false. Persiste via un Zustand/atom scoped à la session OU simplement `useQuery` avec invalidation SSE (préférer le second, moins de dep).
3. Extraire `AppHeader` depuis `$id.tsx` (lignes ~130-250 actuellement inline). Le rendre **sticky** (`position: sticky; top: 0; z-index: 30; backdrop-blur`).
4. Refaire le bouton Deploy en **split-button shadcn** (`Button` + `DropdownMenuTrigger asChild`). Quand `useActiveBuild.isActive === true`, forcer label "Deploying…" + `<Loader2 className="animate-spin" />` + disabled.
5. Refaire le menu Actions avec `DropdownMenu` shadcn (remplace le `<div role="menu">` maison).
6. Wrapper Stop / Restart / Rollback / Delete dans `AlertDialog` shadcn avec bouton confirm rouge pour les destructives.
7. Rollback : au clic, ouvrir dialog qui liste les 10 derniers builds **filtrés `status === 'succeeded'`**, avec commit SHA + message. Ne plus utiliser `latestBuildId` implicitement.
8. **Auto-redirect post-Deploy** : après que `useDeployApp.mutate()` résout (202), `router.navigate({ to: '/apps/$id/deployments', params, search: { build: newBuildId } })`. La route deployments viendra en Wave 2 — pour l'instant rediriger sur `/apps/$id/builds` (route actuelle) et laisser Wave 2 rename.
9. **Delete** : ajouter le bouton Actions → `DELETE /apps/:id` (endpoint déjà présent). Après succès, `router.navigate({ to: '/apps' })`.
10. Badge : ajouter animation `animate-pulse` conditionnelle sur `status === 'building' || 'deploying'`.
11. Ajouter `use-active-build.test.ts` (mock SSE), `AppHeader.test.tsx` (rendu + clic Deploy déclenche mutation + redirect), `apps-mutations.test.ts` (smoke sur chaque mutation).

**DoD :**
- `bunx tsc -p apps/web/tsconfig.json --noEmit` vert
- `bun test apps/web/src/tests/ apps/web/src/components/apps/` vert
- `bun run lint` vert côté web
- Pas de régression dans `apps/api/src/routes/apps.test.ts` (les endpoints ne bougent pas en Wave 1)
- Rapport avec : fichiers touchés, tests ajoutés, impact visuel (1 phrase).

**Interdits :**
- Ne **pas** toucher aux routes `routes/_authed/apps/$id/{overview,builds,logs,settings,env,domains}.tsx` hors imports.
- Ne **pas** toucher à `routes/_authed/apps/$id/index.tsx`.
- Ne **pas** toucher à `apps/api/src/routes/apps.ts`.
- Ne **pas** créer les composants Wave 2/3 (DeploymentsTable, AppMonitoringCard, etc.).

---

## Wave 2 — Contenu principal (P1 + P2) — PARALLÈLE (2 agents)

**Prérequis** : Wave 1 mergée (split `apps-mutations.ts` en place, AppHeader découplé).

### Milestone 2.A — Deployments tab (ex-Builds) + Logs épuré

**Owner exclusif :**

**Modifie :**
- `apps/web/src/routes/_authed/apps/$id.tsx` (**uniquement** le tableau des tabs : renommer "Builds" → "Deployments", retirer sous-onglets logs)
- `apps/web/src/routes/_authed/apps/$id/logs.tsx` (retire les sous-onglets Build / Deployment, garde seulement le runtime container log)
- `apps/web/src/lib/apps-mutations.ts` (étend `useRollbackApp` pour accepter un `buildId` cible explicite)
- `apps/api/src/routes/apps.ts` (endpoint `POST /apps/:id/rollback` accepte `{ buildId: string }` dans le body, fallback ancien comportement si absent)
- `apps/api/src/routes/apps.test.ts` (couvre rollback avec buildId explicite)

**Crée / Renomme :**
- `apps/web/src/routes/_authed/apps/$id/deployments.tsx` (contenu refondu — **renomme** le fichier `builds.tsx`)
- `apps/web/src/routes/_authed/apps/$id/index.tsx` **mise à jour** redirect : `/apps/$id` → `/apps/$id/overview` (reste, inchangé)
- Nouvelle route de redirect `builds.tsx` → `deployments.tsx` ? Non : juste supprimer `builds.tsx` et ajouter le lien "Deployments" dans les tabs. Laisser TanStack regen le route tree.
- `apps/web/src/components/apps/DeploymentsTable.tsx` (DataTable enrichi : commit SHA tronqué, **commit message**, author, status chip, durée, dropdown actions par ligne : "View logs" (drawer) / "Rollback" (dialog confirm, uniquement si status = succeeded))
- `apps/web/src/components/apps/BuildLogDrawer.tsx` (Drawer shadcn plein écran, wrap `BuildLogViewer`, ouvert via `?build=<id>` search param)
- Tests : `DeploymentsTable.test.tsx`, `BuildLogDrawer.test.tsx`

**Tâches concrètes :**
1. Renommer `routes/_authed/apps/$id/builds.tsx` → `deployments.tsx` via `git mv`. Régénérer `routeTree.gen.ts` via `bunx --bun @tanstack/router-cli generate` (cwd `apps/web`).
2. Dans `$id.tsx`, changer le lien tab : `{ label: 'Builds', to: '...builds' }` → `{ label: 'Deployments', to: '...deployments' }`. **Ne toucher que cette ligne du tableau** (ownership partagé précis avec Wave 1 verrouillée par diff review).
3. Refondre la page `deployments.tsx` : utilise `DeploymentsTable` au lieu de l'inline actuel.
4. `DeploymentsTable` affiche : commit sha court + message (tronqué à 60ch, tooltip complet), status badge, durée formatée, author ou branch, menu actions par ligne.
5. `BuildLogDrawer` : Drawer shadcn right-side ou full-height, contient `BuildLogViewer` + bouton "Close" + bouton "Download". Ouvre quand `?build=<id>` dans search params.
6. `logs.tsx` : retirer le `<Tabs>` interne (sous-onglets Build/Runtime/Deployment). Garder uniquement la vue runtime container. Plus de `<select>` de build.
7. **API `/rollback`** : étendre pour accepter `{ buildId?: string }`. Si fourni → rollback vers ce build précis, sinon comportement legacy. Ajouter test API.
8. `useRollbackApp` dans `apps-mutations.ts` : accepter `{ buildId?: string }` en argument.
9. Ajouter tests : rendu table, clic "View logs" ouvre drawer, rollback n'est dispo que pour succeeded, mutation API reçoit le buildId.

**DoD :**
- `bunx tsc -p apps/web/tsconfig.json --noEmit` vert
- `bun test apps/web/src/ apps/api/src/` vert
- `bun run lint` vert
- Route `/apps/$id/deployments` fonctionne, `/apps/$id/builds` **n'existe plus** (404 attendu ou redirect doc).

**Interdits :**
- Ne **pas** toucher à `overview.tsx`, `settings.tsx`, `env.tsx`, `domains.tsx`.
- Ne **pas** toucher à `lib/apps.ts` (propriété de 2.B).
- Ne **pas** toucher à `components/apps/AppHeader.tsx`, `DeployButton.tsx`, `ActionsMenu.tsx`, `AppStatusBadge.tsx` (Wave 1).

### Milestone 2.B — Overview live + data layer fix

**Owner exclusif :**

**Modifie :**
- `apps/web/src/routes/_authed/apps/$id/overview.tsx` (refonte complète)
- `apps/web/src/lib/apps.ts` (fix double-fetch : `useApp` prend `initialData` du loader ; `normalizeAppDetail` remonte les 4 champs healthcheck perdus ; `useBuilds` prend `initialData` depuis `app.builds[]` si fourni par le loader)

**Crée :**
- `apps/web/src/components/apps/AppMonitoringCard.tsx` (wrapper scoped-to-app de `ResourceCard` : filtre les `container.health` SSE sur cette app uniquement ; affiche CPU / mem / uptime / restarts)
- `apps/web/src/components/apps/LastDeploymentCard.tsx` (dernier build : commit, status, durée, auteur, lien "View logs" → drawer géré par 2.A existera après merge — prévoir un fallback vers `/apps/$id/deployments`)
- `apps/web/src/components/apps/ActivityFeed.tsx` (liste condensée des 10 derniers events SSE liés à cette app : build.*, deploy.status_change, container.health anomalies)
- `apps/web/src/lib/hooks/use-app-events.ts` (filtre le stream SSE par `appId`)
- Tests : `AppMonitoringCard.test.tsx`, `LastDeploymentCard.test.tsx`, `ActivityFeed.test.tsx`, `use-app-events.test.ts`, `apps.test.ts` (test normalize)

**Tâches concrètes :**
1. `normalizeAppDetail` : ajouter `healthcheckIntervalS`, `healthcheckTimeoutS`, `healthcheckRetries`, `healthcheckStartPeriodS` au type `AppDetail` et mapper depuis la réponse API. Test unitaire dédié.
2. `useApp(id, { initialData })` : accepter un `initialData` optionnel. Le layout `$id.tsx` devra le passer via loader → mais **Wave 1 possède déjà le loader** ; vérifier. Si Wave 1 n'a pas exposé `loaderData` au hook, ici mettre à jour `useApp` pour le supporter et **laisser un commentaire** pour que le consommateur (le layout) puisse s'en servir — sans toucher `$id.tsx` (propriété Wave 1). **Alternative** : utiliser `queryClient.setQueryData` au mount via `Route.useLoaderData()` depuis overview.tsx seulement. **Retenir cette alternative** (plus propre, aucun conflit d'ownership).
3. `useBuilds(id, { initialData })` : idem, accepter `initialData` depuis loader. Overview.tsx n'appelle pas `useBuilds` directement pour l'instant — `LastDeploymentCard` consomme `useApp` dont `builds[]` existe (vérifier si le GET /apps/:id renvoie déjà builds[]).
4. Overview v2 layout :
   - Ligne 1 : `<AppMonitoringCard />` pleine largeur (ou 2/3) + `<LastDeploymentCard />` (1/3)
   - Ligne 2 : grid d'InfoCards condensée (branch, repo, domain, healthcheck summary)
   - Ligne 3 : `<ActivityFeed />` + `<RegistryUsageWidget />` (garder celui-ci, il est déjà là)
5. `AppMonitoringCard` : consomme `useMonitoringEvents` ou crée son propre filtre SSE. Reuse `ResourceCard` de `components/monitoring/ResourceCard.tsx` **sans le modifier** (juste l'importer et le feed avec le bon snapshot filtré par `appId`). Si `ResourceCard` attend un format différent, créer un adapter local **dans** `AppMonitoringCard.tsx`.
6. `ActivityFeed` : consomme `useAppEvents(appId)` → liste paginée des 10 derniers events. Affiche icône + message humain + timestamp relatif.
7. Tests complets sur les 3 composants + hook.

**DoD :**
- `bunx tsc -p apps/web/tsconfig.json --noEmit` vert
- `bun test apps/web/src/` vert
- `bun run lint` vert
- Overview affiche CPU live quand l'app tourne (vérification manuelle décrite en rapport).
- `healthcheckIntervalS` etc. remontent dans AppDetail (testé).

**Interdits :**
- Ne **pas** toucher à `deployments.tsx`, `builds.tsx`, `logs.tsx`, `settings.tsx`, `env.tsx`, `domains.tsx`.
- Ne **pas** toucher à `$id.tsx`, `AppHeader.tsx`, `DeployButton.tsx`, `ActionsMenu.tsx`.
- Ne **pas** toucher à `lib/apps-mutations.ts`.
- Ne **pas** toucher à `apps/api/src/routes/apps.ts`.
- Ne **pas** modifier `components/monitoring/ResourceCard.tsx` (réutiliser tel quel).

---

## Wave 3 — Richesse (P3 + P4 + P5) — PARALLÈLE (3 agents)

**Prérequis** : Wave 2 mergée.

### Milestone 3.A — Logs runtime enrichi

**Owner exclusif :**
- `apps/web/src/routes/_authed/apps/$id/logs.tsx`
- `apps/web/src/components/apps/BuildLogViewer.tsx` (étendre : filtres + auto-scroll sticky)
- `apps/web/src/components/apps/LogFilters.tsx` (nouveau)
- Tests associés

**Tâches :**
- Auto-scroll bas par défaut, désactivation automatique si l'user scroll up (pattern `MutationObserver` Coolify).
- Filtres : volume (100/500/1000/5000), level (all/info/warn/error), search input full-text.
- Pause/Resume + Download button.

### Milestone 3.B — Environment MVP

**Owner exclusif :**
- `apps/web/src/routes/_authed/apps/$id/env.tsx`
- `apps/web/src/components/apps/EnvTable.tsx` (nouveau)
- `apps/web/src/lib/apps-env.ts` (nouveau : hooks GET/PATCH env)
- `apps/api/src/routes/apps.ts` (ajouter/étendre endpoints `GET/PATCH /apps/:id/env` si pas déjà présents)
- Schema DB + migration si table env_vars manquante
- Tests

**Tâches :**
- Table KV avec inline edit, masquage secrets par défaut ("Reveal" per-row + "Reveal all").
- Save explicite global (pas d'auto-save).
- Validation noms (UPPER_SNAKE_CASE).

### Milestone 3.C — Domains MVP

**Owner exclusif :**
- `apps/web/src/routes/_authed/apps/$id/domains.tsx`
- `apps/web/src/components/apps/DomainsTable.tsx` (nouveau)
- `apps/web/src/lib/apps-domains.ts` (nouveau)
- `apps/api/src/routes/apps.ts` (endpoints `GET/POST/DELETE /apps/:id/domains` si manquants) + intégration Caddy
- Schema DB + migration si table domains manquante
- Tests

**Tâches :**
- Liste domaines + statut TLS via Caddy admin API (`apps/api/src/caddy/client.ts` déjà présent).
- Ajout / suppression, re-check certificat.

**Note conflit potentiel Wave 3** : 3.B et 3.C touchent tous deux `apps/api/src/routes/apps.ts`. **Solution** : splitter **avant Wave 3** en `routes/apps/env.ts` et `routes/apps/domains.ts`, ou donner 3.B en priorité et lancer 3.C après. À trancher avant de lancer.

---

## Wave 4 — Polish (P6) — PARALLÈLE (4 agents max)

- **4.A** : Cmd+K global search (`cmdk` shadcn, navigue entre apps et sections)
- **4.B** : Shortcuts `g+x` entre tabs (au niveau du layout `$id.tsx`)
- **4.C** : Monaco Editor pour env multilignes (Dockerfile, YAML, JSON)
- **4.D** : Preview Deployments sur PR (côté API + UI)

À planifier une fois Wave 3 stabilisée.

---

## Checklist pré-lancement de CHAQUE wave

- [ ] `git status` propre ou changements en zone sûre
- [ ] Wave précédente mergée et testée
- [ ] Pas de `make dev` / `bun run dev` en cours que l'agent pourrait accidentellement killer
- [ ] Ports 4000 (API) et 5173 (Web) au repos **ou** stables (user owns)
- [ ] Ownership validé : zero overlap listé explicitement ci-dessus

## Commandes de validation finale par wave

```bash
# Typecheck monorepo
bunx tsc -p apps/web/tsconfig.json --noEmit
bunx tsc -p apps/api/tsconfig.json --noEmit

# Tests ciblés
bun test apps/web/src/ apps/api/src/

# Lint
bun run lint

# SPDX (toujours)
bun run check:spdx
```
