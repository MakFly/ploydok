# PLAN — Sprint 3 finishing : log_path + SSE live + DataTable + blue-green

## Vue d'ensemble

Cinq gaps bloquent la fin du Sprint 3 :

1. **log_path jamais écrit** → `GET /apps/:id/logs` renvoie 404 dès que le fallback HTTP déclenche depuis `BuildLogViewer`.
2. **Tab Builds non SSE-live** → aucune invalidation React Query sur les events `build.*`, le tableau reste figé.
3. **NotificationBell** → `markAllRead()` tiré à l'ouverture (mauvaise UX) et reducer qui drop les events quand `connected=false`.
4. **Table Builds HTML brut** → pas de pagination, pas de tri. Besoin d'un `DataTable` shadcn factorisé dans `packages/ui/` (pageSize 5).
5. **M3.3 blue-green jamais câblé** → le pipeline s'arrête au push registry, aucun container ne démarre.

Trois waves permettent à 3 agents de travailler en parallèle sans collision de fichiers. Wave 1 dépose les fondations indépendantes (worker log archivage, fix bell, DataTable packagée). Wave 2 fait converger (builds.tsx = DataTable + SSE). Wave 3 câble blue-green.

---

## Pré-requis

- `apps/api/.env.local` : `PLOYDOK_BUILD_DIR` déjà défini (logs archivés dedans).
- Aucune nouvelle dépendance npm hors wave 1 (task C — voir plus bas).
- Tests : `bun test apps/api/src/worker/handlers/` + `bunx tsc -p apps/web/tsconfig.json --noEmit` avant merge de chaque wave.

---

## Wave 1 — Fondations parallèles (3 agents, 0 collision)

### A — worker log archivage (log_path)

**Goal** : Persister sur disque toutes les lignes publiées sur `logBus` pendant un build et remplir `builds.log_path`.

**Files owned (exclusivement)** :
- `apps/api/src/worker/handlers/deploy.ts` (modification — section `onLog` + finally)
- `packages/db/src/queries/builds.ts` (modification — `updateBuildStatus` accepte déjà `logPath` via `imageTag`-style ; sinon étendre)
- `apps/api/src/worker/handlers/deploy.test.ts` (modification — assert log file créé)

**Tasks** :
- [ ] Avant le `try` principal (après `updateBuildStatus(db, buildId, "running", …)`), créer `${env.PLOYDOK_BUILD_DIR}/${app.id}/${buildId}.log` via `fs.createWriteStream` (mkdir -p).
- [ ] Modifier la fonction locale `onLog(line)` : `stream.write(line + "\n")` en plus du `logBus.publish`.
- [ ] Dans le `finally`, `stream.end()` + `updateBuildStatus(db, buildId, status, { logPath })` une seule fois.
- [ ] `deploy.ts` ne doit PAS toucher `blue-green` (M3.3 reste TODO — wave 3 s'en occupe).
- [ ] Test : mock fs, déclenche handleDeployJob, assert `writeFile` ou `createWriteStream` appelé avec le path attendu.

**Tests à passer** :
```bash
bun test apps/api/src/worker/handlers/deploy.test.ts
bunx tsc -p apps/api/tsconfig.json --noEmit
```

**Non-goal** : ne pas modifier l'endpoint `GET /apps/:id/logs` — il est correct.

---

### B — fix NotificationBell + reducer

**Goal** : Le badge de la bell doit refléter TOUS les events reçus, peu importe `connected`, et `markAllRead` doit se tirer à la **fermeture** du popover.

**Files owned** :
- `apps/web/src/components/layout/NotificationBell.tsx`
- `apps/web/src/lib/notifications.ts`
- `apps/web/src/lib/notifications.test.ts` (nouveau si absent)

**Tasks** :
- [ ] `notifications.ts` L68 : `push` incrémente `unreadCount` inconditionnellement (supprimer le ternaire `state.connected ?`).
- [ ] `NotificationBell.tsx` L63-68 : `handleToggle` = `setOpen(v => !v)`. Ajouter `useEffect` qui appelle `markAllRead()` quand `open` **passe de true → false** (avec ref pour tracker la transition).
- [ ] Ajouter test unitaire reducer : `push` après `disconnect` incrémente bien le compteur.
- [ ] Vérifier que le `<button>` du bell affiche `RiNotification3Fill` quand `unreadCount > 0` (déjà le cas) — pas de régression.

**Tests** :
```bash
bun test apps/web/src/lib/notifications.test.ts
bunx tsc -p apps/web/tsconfig.json --noEmit
```

**Non-goal** : ne pas toucher `EventsProvider` ni `events-provider.tsx`.

---

### C — DataTable shadcn dans packages/ui/

**Goal** : Composant `DataTable<T>` + `DataTablePagination` réutilisable, `pageSize: 5` par défaut, configurable.

**Files owned** :
- `packages/ui/src/components/data-table.tsx` (nouveau)
- `packages/ui/src/index.ts` (modification — export)
- `packages/ui/package.json` (modification — ajout `@tanstack/react-table` si absent)
- `packages/ui/src/components/data-table.test.tsx` (nouveau)

**Tasks** :
- [ ] `bun add @tanstack/react-table -w packages/ui` (si pas déjà là).
- [ ] Composant générique `<DataTable columns rows pageSize={5} />` basé sur `useReactTable` + `getCoreRowModel` + `getPaginationRowModel`.
- [ ] Sous-composant `<DataTablePagination />` (boutons Prev/Next + page indicator) — style shadcn (Button variant outline sm).
- [ ] Support colonnes simples `{ id, header, accessorKey, cell? }` — pas besoin de sort/filter en v1.
- [ ] SPDX header. Export nommé depuis `packages/ui/src/index.ts`.
- [ ] Test : 12 rows → 3 pages de 5/5/2, click Next → rows 6-10 visibles.

**Tests** :
```bash
bun test packages/ui/src/components/data-table.test.tsx
bunx tsc -p packages/ui/tsconfig.json --noEmit
```

**Non-goal** : ne pas modifier `apps/web/src/routes/_authed/apps/$id/builds.tsx` (wave 2 s'en occupe).

---

## Wave 2 — Builds tab = DataTable + SSE live (1 agent, après A + C)

### D — refactor builds.tsx

**Goal** : La tab Builds utilise le `DataTable` wave-1-C, pageSize 5, et invalide React Query sur chaque event `build.*` / `deploy.status_change`.

**Files owned** :
- `apps/web/src/routes/_authed/apps/$id/builds.tsx`
- `apps/web/src/lib/apps.ts` (modification — `useBuilds` ajoute `useEventsSubscription`)

**Dépendances** :
- Attend **A** (log_path) — pour ne pas casser les logs archivés pendant qu'on refactor la cellule clic.
- Attend **C** (DataTable) — l'import vient de `@ploydok/ui`.

**Tasks** :
- [ ] Dans `useBuilds` : après le `useQuery`, ajouter 4× `useEventsSubscription` (`build.started`, `build.succeeded`, `build.failed`, `deploy.status_change`) → chacun appelle `qc.invalidateQueries({ queryKey: ["apps", appId, "builds"] })` + invalide aussi `["apps", appId]` pour le header status.
- [ ] Remplacer le `<table>` manuel de `builds.tsx` par `<DataTable columns={buildColumns} rows={builds} pageSize={5} />`.
- [ ] `buildColumns` définit : Build ID (mono), Status (badge BUILD_STATUS_CLASS), Commit, Method, Duration, Started. Clic sur une row → `setSelectedBuildId` (via `meta` ou render custom).
- [ ] Garder le panneau `<BuildLogViewer>` en dessous quand `selectedBuildId` est set.
- [ ] Test e2e léger : monter la route avec 7 builds mockés → 2 pages, pagination visible.

**Tests** :
```bash
bun test apps/web/src/routes/_authed/apps/\$id/builds.test.tsx
bunx tsc -p apps/web/tsconfig.json --noEmit
```

**Non-goal** : ne pas toucher `BuildLogViewer` ni la route `/logs`.

---

## Wave 3 — runBlueGreen câblé (1 agent, après A)

### E — pipeline deploy complète

**Goal** : Après push de l'image au registry, le worker doit appeler `runBlueGreen` (déjà présent dans `apps/api/src/worker/runner.ts`) et publier les events de transition.

**Files owned** :
- `apps/api/src/worker/handlers/deploy.ts` (modification — ajout étape 4)
- `apps/api/src/worker/runner.ts` (lecture seule — vérifier signature, ne pas modifier)
- `apps/api/src/worker/handlers/deploy.test.ts` (modification — mock runBlueGreen)

**Dépendances** :
- Attend **A** (log_path) — pour éviter un merge conflict sur `deploy.ts`. Si A est mergé, ce diff est propre.

**Tasks** :
- [ ] Après l'étape 3 (build + push, Docker ET Nixpacks), avant l'étape 5 (mark succeeded), appeler `runBlueGreen({ app, imageRef, buildId, onLog })`.
- [ ] Capturer le `containerId` retourné → `updateBuildStatus(db, buildId, "running", { containerId })` + `updateAppStatus(db, app.id, "running", { containerId, domain })`.
- [ ] Publier event `deploy.status_change` avec message « Container live » avant mark succeeded.
- [ ] Sur `runBlueGreen` throw : le `catch` existant attrape déjà, mark failed + event `build.failed`. Vérifier que l'ancien container n'est pas stoppé en cas d'échec (runner.ts doit garantir ça — lire pour confirmer, sinon c'est un TODO wave 4).
- [ ] Test : mock `runBlueGreen`, assert ordre appels + events publiés.

**Tests** :
```bash
bun test apps/api/src/worker/handlers/deploy.test.ts
bun test apps/api/src/worker/
bunx tsc -p apps/api/tsconfig.json --noEmit
```

**Non-goal** : ne pas toucher `runner.ts`, ne pas implémenter healthcheck custom (reste sprint 4 si besoin).

---

## Ordre d'exécution recommandé avec /team

### Option « full parallèle » (4 agents)

Wave 1 : 3 agents en parallèle (A, B, C). Attendre completion totale.
Wave 2 : 1 agent (D).
Wave 3 : 1 agent (E) — peut tourner en parallèle de Wave 2 (fichiers disjoints) **si A est mergé**.

### Option « safe séquentielle » (1 agent, 1h30)

Ordre : A → B → C → D → E.

---

## Definition of Done global

- [ ] `GET /apps/:id/logs?buildId=<id>` renvoie le log archivé (200 text/plain) après un build réel.
- [ ] La tab Builds se rafraîchit sans F5 pendant un build qui passe `pending → running → succeeded`.
- [ ] La bell affiche le badge correct même après reconnect EventSource, `markAllRead` ne tire qu'à la fermeture.
- [ ] La tab Builds affiche 5 lignes max + pagination fonctionnelle.
- [ ] Un deploy déclenché via « Deploy » démarre un container, passe `running`, et devient accessible sur son domaine Caddy (validable manuellement).
- [ ] `bun test` global vert, `bunx tsc --noEmit` vert sur apps/web + apps/api + packages/ui.
- [ ] `bun run check:spdx` vert.

---

## Non-couvert (hors scope explicite)

- DoD `bun scripts/run-dod.ts` (11 items Playwright) — à lancer après cette PR, pas dans le scope du plan.
- Healthcheck custom granulaire par app (sprint 3 original item) — reste en backlog sprint 3bis.
- Secrets chiffrés / domaines custom — sprint 4.
