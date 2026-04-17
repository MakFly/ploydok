# Research — Refonte app-detail `/apps/$id/*`

Date : 2026-04-17
Scope : `/apps/$id/{overview,logs,builds,settings,env,domains}`
Stack : TanStack Start + React 19 + shadcn + Tailwind v4 + SSE (`/events`) + WS logs

## Summary

Ploydok a déjà **les briques** (SSE cache-invalidation, `ResourceCard` + `MetricCardButton` + `MetricDetailDialog` déjà polish, `LogConsole` partagé, layout tabs) mais les utilise mal : double-fetch loader+query, onglets placeholders (Env/Domains/Deployment logs), monitoring absent de la page app alors qu'il existe ailleurs, rollback borgne, bouton Deploy sans progression. La refonte doit **rebrancher l'existant** avant d'ajouter du neuf. Le plan en 6 vagues ci-dessous va chercher le meilleur de Dokploy (taxonomie d'actions, log viewer riche, rollback inline) et Coolify (auto-scroll MutationObserver, badge animé, Cmd+K) sans hériter de leurs dettes (save incohérent, general trop dense, redirect manquant post-Deploy).

---

## Findings — état actuel Ploydok

### F1. Double-fetch systématique sur `GET /apps/:id`
- **Evidence** : strong — Layer 1
- **Source** : `apps/web/src/routes/_authed/apps/$id.tsx:21-27` loader + `apps/web/src/lib/apps.ts:122` `useApp(id)`
- **Détails** : chaque navigation vers une sous-route déclenche 2 appels API. Le `staleTime: 15_000` absorbe parfois le doublon mais rien ne le garantit.

### F2. `builds[]` renvoyé mais ignoré
- **Evidence** : strong — Layer 1
- **Source** : `apps/web/src/routes/_authed/apps/$id.tsx:22` ignore `builds` ; `useBuilds` refait un appel `GET /apps/:id/builds`.
- **Détails** : round-trip gratuit à chaque montage de la tab Builds.

### F3. Rollback borgne
- **Evidence** : strong — Layer 1
- **Source** : `$id.tsx:91-100` — `handleRollback` prend `currentApp.latestBuildId` sans vérifier `status === 'succeeded'`.
- **Détails** : possibilité de rollback vers un build `failed`. Pas de sélection explicite, pas de commit message affiché.

### F4. Bouton Deploy découplé du build réel
- **Evidence** : strong — Layer 1
- **Détails** : le bouton repasse à "Deploy" dès le 202 (mutation pending = faux), avant que le build ne commence. Pas de progress persistant dans le header. L'utilisateur doit aller dans l'onglet Builds pour voir si ça avance.

### F5. Onglets placeholders
- **Evidence** : strong — Layer 1
- **Source** : `routes/_authed/apps/$id/env.tsx`, `domains.tsx`, et sous-onglet Deployment de `logs.tsx:95-98`.
- **Détails** : 2 tabs principaux + 1 sous-tab affichent "coming soon". Fausse impression de complétude.

### F6. Monitoring existant mais non utilisé dans app-detail
- **Evidence** : strong — Layer 1
- **Source** : `apps/web/src/components/monitoring/{ResourceCard,MetricCardButton,MetricDetailDialog,StatusDot}.tsx` — utilisés uniquement dans `/monitoring` global, jamais dans `apps/$id/overview.tsx`.
- **Détails** : la page Overview n'affiche que des métadonnées statiques alors que `container.health` SSE remonte déjà CPU/mem/restart/uptime.

### F7. Dropdown Actions maison sans a11y
- **Evidence** : strong — Layer 1
- **Source** : `$id.tsx:197-241` — `<div role="menu">` avec `useEffect` custom, pas `DropdownMenu` shadcn.
- **Détails** : pas de gestion clavier (Escape/flèches), pas d'`aria-disabled`. Stop/Restart déclenchés sans confirm.

### F8. Logs tab duplique Builds tab
- **Evidence** : strong — Layer 1
- **Source** : `logs.tsx` — sous-onglet Build a un `<select>` de builds, tandis que `builds.tsx` affiche une DataTable des mêmes builds.
- **Détails** : 2 UX différentes pour la même donnée. Le sous-onglet Deployment est vide.

### F9. Healthcheck : champs perdus
- **Evidence** : strong — Layer 1
- **Source** : `lib/apps.ts:56-63` `normalizeAppDetail` omet `intervalS/timeoutS/retries/startPeriodS` que l'API expose.
- **Détails** : le formulaire Settings ne peut pas éditer ces champs alors que l'API les accepte en PATCH.

---

## Findings — Dokploy (ce qu'on vole, ce qu'on évite)

### F10. Taxonomie Deploy / Reload / Rebuild — **à voler**
- **Evidence** : strong — Layer 1
- **Source** : https://docs.dokploy.com/docs/core/applications, blog v0.24.0
- **Détails** : 3 niveaux d'action distincts (build complet / reload sans rebuild / rebuild sans re-fetch). Évite les builds inutiles.

### F11. Rollback inline dans la liste des déploiements — **à voler**
- **Evidence** : strong — Layer 1
- **Source** : https://dokploy.com/blog/v0-24-0-rollbacks-docker-volume-backups-more
- **Détails** : bouton Rollback à côté de chaque ligne de déploiement, pas d'onglet séparé. Résout aussi la critique #3266 de Coolify.

### F12. Log viewer avec filtres multi-dimensionnels — **à voler**
- **Evidence** : strong — Layer 1
- **Source** : DeepWiki Dokploy Monitoring/Logging
- **Détails** : volume (50/500/5000 lignes), plage horaire, niveau, full-text search, pause/resume, keepalive WS 45s.

### F13. Redirection manquante post-Deploy — **à éviter**
- **Evidence** : strong — Layer 2
- **Source** : https://github.com/Dokploy/dokploy/issues/680 (ouvert depuis 2024)
- **Détails** : après clic Deploy, l'user doit naviguer manuellement vers l'onglet Deployments pour voir les logs. Ploydok doit **rediriger automatiquement**.

### F14. Status non sticky, General tab trop dense — **à éviter**
- **Evidence** : moderate — Layer 2
- **Détails** : statut inféré du label du bouton Start/Stop. Trop de concepts (Deploy, Reload, Rebuild, Start/Stop, Terminal, Autodeploy, Clean Cache) dans une seule Card.

---

## Findings — Coolify (ce qu'on vole, ce qu'on évite)

### F15. Auto-scroll logs MutationObserver stop-on-exitCode — **à voler**
- **Evidence** : strong — Layer 1
- **Source** : `ActivityMonitor` Livewire + Alpine.js MutationObserver
- **Détails** : log ancré en bas pendant le build, stop polling quand exitCode apparaît. Simple et efficace.

### F16. Global search Cmd+K (MagicBar) — **à voler**
- **Evidence** : strong — Layer 1
- **Source** : https://coolify.io/docs, TECH_STACK.md
- **Détails** : navigation keyboard-first entre ressources. shadcn a `cmdk` out-of-the-box.

### F17. Preview Deployments sur PR — **à voler** (P5, pas P0)
- **Evidence** : strong — Layer 2
- **Détails** : URL template configurable, automatique dès PR ouverte.

### F18. Badge status animé en header — **à voler**
- **Evidence** : moderate — Layer 2
- **Détails** : Running / Deploying (animé) / Stopped, wording clair, visible en permanence.

### F19. Navigation profonde, save buttons incohérents, erreurs génériques — **à éviter**
- **Evidence** : strong — Layer 2
- **Source** : GitHub #2508, #3266, #8336 ; HN apr. 2025 "incredibly clunky"
- **Détails** : Coolify oblige 2-3 clics pour config, save inconsistant selon sections, logs non scrollables pendant deploy, messages d'erreur "are you okay?" non actionnables.

---

## Proposition de refonte — le meilleur des 3 mondes

### Structure de navigation (finale, 6 tabs, 0 placeholder)

```
/apps/$id/
├── overview            (Overview) — status + métriques live + dernier deploy
├── deployments         (fusion Builds + Rollback)
├── logs                (runtime container UNIQUEMENT)
├── environment         (remplace env, réel)
├── domains             (réel)
└── settings            (build config + healthcheck complet)
```

- **Tab "Builds"** disparaît → devient `deployments` (Dokploy + Coolify convergent ici).
- **Sous-onglets de Logs** disparaissent → build logs accessibles depuis `deployments` (clic sur une ligne ouvre un drawer log).
- **Danger Zone** en bas de `settings` (delete — actuellement endpoint existe mais pas de bouton).

### Header persistant (sticky)

```
┌─────────────────────────────────────────────────────────────────┐
│ breadcrumb: Apps / my-app                                       │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ my-app  [●Running]  <url cliquable>   [Deploy ▾] [Actions ▾]│ │
│ └─────────────────────────────────────────────────────────────┘ │
│ [Overview] [Deployments] [Logs] [Environment] [Domains] [⚙]    │
└─────────────────────────────────────────────────────────────────┘
```

- **Status badge animé** (Coolify F18) : dot qui pulse quand `building`/`deploying`.
- **Deploy split-button** (Dokploy F10) : primary = Deploy ; dropdown = `Redeploy (same commit)` / `Rebuild without cache`.
- **Actions dropdown** = shadcn `DropdownMenu` (fix F7) : Stop / Restart / Rollback (ouvre dialog de sélection).
- Confirmations shadcn `AlertDialog` pour Stop/Restart/Delete.

### Overview — redevient la page centrale

1. **ResourceCard** (déjà codée, F6) branchée sur le `container.health` SSE de cette app → CPU/mem/restart/uptime live.
2. **Dernier déploiement** : status chip + commit message + durée + lien "View logs" (ouvre drawer build log).
3. **InfoCards** actuels (branch, domain, repo, healthcheck) — gardés, densité réduite.
4. **Activity feed** : 5 derniers events SSE de cette app (build.*, deploy.status_change, container.health anomalies).

### Deployments (ex-Builds, ex-Rollback-Coolify)

- DataTable : commit SHA + **message de commit** (manquant actuellement) + status + durée + author + bouton "Logs" + bouton "Rollback" **uniquement si status = succeeded** (fix F3).
- Clic sur une ligne → drawer plein écran avec `BuildLogViewer`.
- Clic Rollback → dialog `AlertDialog` avec le commit cible résumé.

### Logs (runtime pur)

- `BuildLogViewer` wrap `LogConsole` existant.
- **Auto-scroll MutationObserver** (Coolify F15) + bouton "Follow" qui se désactive quand l'user scroll up.
- **Filtres** (Dokploy F12) : volume, niveau, search inline.
- Pause/Resume + Download.

### Environment (MVP)

- Table KV + inline edit + masquage secrets par défaut.
- Bouton "Reveal" per-row + "Reveal all".
- **Save explicite** global (éviter F19 Coolify inconsistent).
- (P5 ultérieur : éditeur Monaco pour valeurs multilignes YAML/JSON.)

### Domains (MVP)

- Liste domaines + statut TLS (via Caddy admin API déjà présent).
- Ajout/suppression, re-check certificat.

### Live feedback unifié (résout F4 + F13)

1. **Auto-redirect post-Deploy** : clic Deploy → redirect vers `/apps/$id/deployments?build=<newId>` avec drawer log ouvert. Résout le pain Dokploy #680.
2. **Bouton Deploy persistant** : passe à "Deploying…" avec spinner **jusqu'à ce que SSE renvoie `build.succeeded|failed`**, pas dès le 202.
3. **Toast global si l'user quitte** : événement SSE `build.started` affiche un toast `<Sonner>` avec action "View" qui ramène sur la tab Deployments — fonctionne depuis n'importe où dans l'app.

---

## Comparaison (Ploydok actuel → cible)

| Critère | Ploydok actuel | Cible (meilleur des 3) |
|---|---|---|
| Nb de tabs fonctionnels | 4/6 (env + domains placeholders) | 6/6 |
| Status visible en permanence | Badge statique dans header | Badge **animé** sticky |
| Feedback d'un deploy en cours | Bouton redevient "Deploy" au 202 | Spinner jusqu'à SSE `succeeded/failed` + auto-redirect vers logs |
| Rollback | Aveugle sur `latestBuildId` | Liste filtrée `succeeded`, sélection explicite, commit message visible |
| Build logs | Tab Builds **et** sous-onglet Logs/Build (dup) | Drawer depuis Deployments, 1 seule UX |
| Logs runtime | Basique | Auto-scroll + filtres volume/level/search + pause/resume |
| Monitoring live dans app-detail | Absent (dispo seulement dans `/monitoring`) | `ResourceCard` dans Overview |
| Env / Domains | Placeholders | MVP fonctionnel |
| Dropdown Actions | `<div>` maison | shadcn `DropdownMenu` + `AlertDialog` confirm |
| Dette data-model | Double-fetch, `builds[]` ignoré, healthcheck champs perdus | Loader sert tout, `useBuilds` initialData, normalize complet |
| Power user | Rien | Cmd+K global + shortcuts `g+x` (P5) |

---

## Plan par vagues

| Vague | Scope | Débloque | Effort |
|---|---|---|---|
| **P0** | Header sticky + status animé + shadcn DropdownMenu + AlertDialog Stop/Restart/Delete + auto-redirect post-Deploy + bouton Deploy lié au SSE | Remet l'UX de base au niveau Dokploy/Coolify | S |
| **P1** | Fusion Builds→Deployments : commit message, Rollback inline `succeeded only`, drawer log, suppression sous-onglets Logs | Résout rollback borgne + duplication Builds/Logs | M |
| **P2** | Overview v2 : injecter `ResourceCard` + activity feed + carte "dernier deploy" ; fix double-fetch en servant `builds[]` du loader via `initialData` | Rebranche le monitoring déjà codé | M |
| **P3** | Logs runtime : auto-scroll MutationObserver + filtres volume/level/search + pause/resume/download | Log viewer riche à la Dokploy | M |
| **P4** | Env MVP : table KV + masquage + save explicite | Élimine le placeholder | M |
| **P5** | Domains MVP : liste + ajout + statut TLS Caddy | Élimine le placeholder | M |
| **P6 (polish)** | Cmd+K global search, shortcuts `g+x` entre tabs, toast SSE persistant multi-page, Monaco pour env multilignes, Preview Deployments | Power-user polish | L |

P0 + P1 + P2 livrent ≈ 80% de la perception "le produit marche". P3-P6 montent en richesse.

---

## Recommendation

**Commencer P0 tout de suite.** Six changements ciblés (< 400 lignes nettes) qui débloquent la perception globale. Ensuite P1 + P2 en parallèle par deux agents (P1 = Deployments, P2 = Overview + data-layer fix) — zéro conflit puisqu'ils touchent des zones disjointes.

Ce qui changerait la reco : si on découvrait que le loader `GET /apps/:id` n'inclut **pas** suffisamment d'info pour P2 (builds + healthcheck complet + container snapshot), il faudrait d'abord un P0.5 sur l'API. À vérifier en ouvrant le handler `apps/api/src/routes/apps.ts`.

## Unknowns

- État réel de l'endpoint `GET /apps/:id` côté API : renvoie-t-il assez pour éliminer les fetchs secondaires d'Overview/Deployments ? (à vérifier avant P2).
- WS logs : coordination avec le SSE `/events` — un seul canal combiné serait plus propre, mais WS déjà installé. À trancher avant P3.
- Rollback côté API : accepte-t-il un `buildId` cible explicite, ou seulement `latestBuildId` ? Si non, P1 nécessite un changement API.

## Bias Check

- **Biais pro-Dokploy** : leur stack est plus proche de Ploydok (React + shadcn), donc facile à copier. Risque de sur-pondérer. Correctif : les patterns Coolify (MutationObserver, Cmd+K) sont UX-level, transposables sans dépendance stack.
- **Biais "refonte totale"** : le vrai levier est de **rebrancher l'existant** (ResourceCard, BuildLogViewer, SSE). Pas d'envie de réécrire par-dessus.
- **Biais "plus de tabs = mieux"** : au contraire, P0 supprime 3 onglets morts sans en ajouter. La structure finale reste à 6 tabs plats.

## Sources

### Codebase Ploydok (Layer 1)
- `apps/web/src/routes/_authed/apps/$id.tsx:21-27, 91-100, 197-241`
- `apps/web/src/lib/apps.ts:24-36, 56-63, 122, 144-161`
- `apps/web/src/routes/_authed/apps/$id/{overview,builds,logs,settings,env,domains}.tsx`
- `apps/web/src/components/monitoring/{ResourceCard,MetricCardButton,MetricDetailDialog}.tsx`
- `apps/web/src/lib/events-provider.tsx`
- `apps/api/src/routes/{apps,events}.ts`

### Dokploy (Layer 1-2)
- https://docs.dokploy.com/docs/core/applications
- https://docs.dokploy.com/docs/core/applications/rollbacks
- https://dokploy.com/blog/v0-24-0-rollbacks-docker-volume-backups-more
- https://github.com/Dokploy/dokploy/issues/680 (redirect post-deploy, 2024)
- https://github.com/Dokploy/dokploy/issues/2607 (real-time logs)
- https://deepwiki.com/Dokploy/dokploy/11-monitoring-and-logging

### Coolify (Layer 1-2)
- https://coolify.io/docs/applications/
- https://github.com/coollabsio/coolify/blob/main/TECH_STACK.md
- https://github.com/coollabsio/coolify/discussions/2508 (dashboard redesign)
- https://github.com/coollabsio/coolify/discussions/3266 (rollback tab mal placé)
- https://github.com/coollabsio/coolify/issues/8336 (logs non scrollables)
- https://news.ycombinator.com/item?id=43555996 (HN avr. 2025)
- https://blog.dreamsofcode.io/coolify-vs-dokploy-why-i-decided-to-use-one-over-the-other

### Comparatifs (Layer 2)
- https://blog.logrocket.com/dokploy-vs-coolify-production/
- https://kloudshift.net/blog/comparing-self-hostable-paas-solutions-caprover-coolify-dokploy-reviewed/
