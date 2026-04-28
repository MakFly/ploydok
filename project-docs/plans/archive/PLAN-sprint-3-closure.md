# PLAN — Sprint 3 closure (+ gap Sprint 1 multi-device)

> Base audit : inspection code réelle 2026-04-19.
> Objectif : fermer proprement Sprints 1/2/3 avant d'enchaîner sur 3bis/4.
> Sprints 4 (GitHub App + dashboard + ApiErrorState) et la refonte `/apps/$id/*` (`PLAN-app-detail-refonte.md`) sont **déjà majoritairement exécutés** — ce plan n'y touche pas.

---

## Verdict d'audit

| Sprint | Statut | Résumé |
|---|---|---|
| **1 — Fondations** | ⚠️ | Tout OK **sauf** multi-device enforcement : `requireSecondFactor` existe (`apps/api/src/auth/middleware.ts:127`) mais n'est monté sur **aucune route**. |
| **2 — Agent + Caddy** | ✅ | Tous les items DoD vérifiables dans le code. Audit log tracé sur chaque RPC (`service.rs`). Reste à valider binaire release < 15 MB en CI (non-bloquant). |
| **3 — Deploy from Git** | ⚠️ | Pipeline complet (BuildKit + Nixpacks + blue-green câblé dans `deploy.ts:376` + GC + healthchecks). **5 gaps concrets ci-dessous**. |

---

## RAF — les 6 blockers

| # | Blocker | Sprint | Impact |
|---|---|---|---|
| R1 | `requireSecondFactor` jamais monté sur les routes mutantes (delete app, rollback, reveal secret…) | 1 | Contrat sécu DoD 1 violé |
| R2 | `healthcheck_start_period_s` stocké en DB mais pas appliqué dans `pollHealthcheck` (`runner.ts:170`) | 3 | Apps à boot lent échouent au premier healthcheck |
| R3 | `nixpacks.ts` n'expose aucun cache persistant (`--cache-from/--cache-to` absents) | 3 | Critère "2ᵉ build < 40% du 1ᵉʳ" invalidable sur path Nixpacks |
| R4 | Widget "Registry usage par app" + bouton "Prune now" absents de l'UI | 3 | Spec 3.6 incomplète, ops n'a aucun lever en cas de disque plein |
| R5 | BuildKit rootless non prouvé : pas de config user-ns/seccomp visible dans `infra/buildkit/` | 3 | DoD "builds rootless vérifiés" non auditable |
| R6 | Aucun run de `bun scripts/run-dod.ts` → 11 specs e2e `⊘ non exécuté` (`project-docs/roadmap/sprint-3-DoD.md`) | 3 | **Blocker final** : pas de preuve bout-en-bout |

---

## Waves

### Wave 1 — Gaps code (parallèle, 3 agents, ~1h30)

#### A — Healthcheck `start_period`

**Owner exclusif :**
- `apps/api/src/worker/runner.ts` (section `pollHealthcheck` + appelant `runBlueGreen`)
- `apps/api/src/worker/runner.test.ts` (ajout test)

**Tâches :**
1. `pollHealthcheck` accepte `startPeriodMs: number` (défaut 0). Sleep initial avant la boucle si > 0.
2. `runBlueGreen` lit `appRow.healthcheck_start_period_s` (déjà en schema, `apps/healthcheck_start_period_s`) et le passe à `pollHealthcheck` × 1000.
3. Test : `start_period=5s` → premier ping retardé d'au moins 5s (utilise `mock.module` ou injection directe de `setTimeout`). Test existant `runBlueGreen_healthy` doit rester vert.

**Non-goal** : ne pas toucher à `rollbackApp` (skip volontaire du grace — comportement voulu).

---

#### B — Cache persistant Nixpacks

**Owner exclusif :**
- `apps/api/src/worker/nixpacks.ts`
- `apps/api/src/worker/nixpacks.test.ts`
- `apps/api/src/worker/handlers/deploy.ts` (**uniquement** l'appelant Nixpacks, ligne ~339 — passage du `cacheDir`)

**Tâches :**
1. Étendre l'interface `nixpacksBuild(opts)` : ajouter `cacheDir: string`.
2. Dans la commande `nixpacks build ...`, ajouter `--cache-key <app_id>` (cache Nixpacks natif) **et** `--docker-cache-from=<registry>/<repo>:cache --docker-cache-to=type=local,dest=<cacheDir>,mode=max` (côté BuildKit sous-jacent, Nixpacks délègue à Docker buildx).
3. `deploy.ts` passe `cacheDir: path.join(env.PLOYDOK_BUILD_DIR, app.id, ".nixpacks-cache")` aux 2 appels (ligne 339 section nixpacks).
4. Test : mock `spawn`, assert flags cache présents.

**Non-goal** : ne pas refaire la signature complète de `nixpacksBuild` — ajout additif seulement.

---

#### C — UI Registry usage + Prune now

**Owner exclusif :**
- `apps/api/src/routes/apps.ts` (endpoint `POST /apps/:id/registry/prune` **si absent** + `GET /apps/:id/registry/usage`)
- `apps/api/src/routes/apps.test.ts` (couverture nouveau endpoint)
- `apps/web/src/components/apps/RegistryUsageWidget.tsx` (existe-t-il ? sinon créer — vérifier `ig "RegistryUsage"`)
- `apps/web/src/routes/_authed/apps/$id/overview.tsx` (insertion widget **si pas déjà là**)
- `apps/web/src/lib/apps-mutations.ts` (étend avec `usePruneRegistry`)

**Tâches :**
1. Endpoint `POST /apps/:id/registry/prune` : wrap `runRegistryGc({ db, appFilter: appId })` + réponse `{ freed_bytes, kept, deleted }`.
2. Endpoint `GET /apps/:id/registry/usage` : retourne `{ used_bytes, image_count, last_gc_at }`. Ré-utiliser helpers de `gc-registry.ts`.
3. Widget : carte shadcn avec barre de progression (vs `env.PLOYDOK_REGISTRY_MAX_GB * 1e9` / N apps — approx), bouton "Prune now" qui appelle la mutation + toast.
4. Challenge passkey **NON requis** (opération réversible, pas destructrice sur les running containers — `runRegistryGc` respecte déjà la protection "container live").
5. Tests : endpoint (200 + 403 non-owner + assert GC appelé), composant (click → mutation → state refresh).

**Non-goal** : pas de cron dashboard admin — déjà en place via `startRegistryGcCron`.

---

### Wave 2 — Sprint 1 multi-device enforcement (séquentielle, 1 agent, ~1h)

#### D — Monter `requireSecondFactor` sur les mutations critiques

**Prérequis** : aucun (indépendant de Wave 1).

**Owner exclusif :**
- `apps/api/src/routes/apps.ts` (ajout middleware sur mutations)
- `apps/api/src/routes/apps.test.ts` (couverture 403 SECOND_FACTOR_REQUIRED)
- `apps/api/src/routes/apps-env.ts` (si `/env` existe en route séparée, sinon dans `apps.ts`)
- `apps/web/src/components/errors/ApiErrorState.tsx` (gérer code `SECOND_FACTOR_REQUIRED` avec CTA "Configurer 2ᵉ facteur" → `/settings/security`)
- `apps/web/src/components/auth/SecondFactorBanner.tsx` (déjà présent — vérifier message + lien corrects)

**Endpoints à protéger** (liste exhaustive) :
- `DELETE /apps/:id`
- `POST /apps/:id/rollback`
- `POST /apps/:id/stop`
- `POST /apps/:id/restart`
- `POST /apps/:id/redeploy` / `POST /apps/:id/deploy`
- `PATCH /apps/:id/env` (reveal + edit secrets)
- `POST /apps/:id/domains` / `DELETE /apps/:id/domains/:name`
- `POST /apps/:id/registry/prune` (si ajouté wave 1-C)

**À NE PAS protéger** : `GET /apps/*` (lecture), `POST /apps` (création première app OK avec 1 passkey).

**Tâches :**
1. Factoriser une chaîne middleware : `const mutating = [requireAuth, requireSecondFactor(db)]` dans `routes/apps.ts` — appliquer sur chaque handler mutant listé ci-dessus via `app.post("/apps/:id/rollback", ...mutating, handler)`.
2. Répercuter sur `apps-env.ts` et `apps-domains.ts` (chacun a déjà `requireAuth`).
3. Frontend : `ApiErrorState` détecte `code === "SECOND_FACTOR_REQUIRED"` → affiche CTA explicite `"Ajoutez une 2ᵉ passkey ou générez des backup codes pour effectuer cette action."` + `<Link to="/settings/security/passkeys">Configurer</Link>`.
4. Tests API : pour chaque endpoint protégé, cas `user avec 1 passkey + 0 backup codes → 403`. Pas besoin de tester chaque endpoint exhaustivement — 1 test "matrice" parametrisé (loop sur la liste).
5. Tests front : `ApiErrorState` rend le CTA correct pour le code `SECOND_FACTOR_REQUIRED`.

**Non-goal** : ne pas toucher au middleware lui-même (`middleware.ts:127` est déjà correct + testé).

---

### Wave 3 — BuildKit rootless proof (parallèle wave 2, 1 agent, ~45min)

#### E — Config buildkitd rootless + audit

**Owner exclusif :**
- `infra/buildkit/` (config `buildkitd.toml` + `Dockerfile` si custom image nécessaire)
- `infra/docker-compose.yml` (flags `security-opt`, user, etc.)
- `project-docs/operations/runbooks/buildkit-rootless.md` (nouveau)
- `scripts/audit-rootless.sh` ou `.ts` (nouveau — retourne 0 si conforme)

**Tâches :**
1. Image : `moby/buildkit:rootless` (déjà suffisant — check compose). Sinon switcher.
2. Compose : `security_opt: ["seccomp=unconfined"]` **interdit**. Utiliser profile par défaut. `userns_mode: private` + user non-root explicite.
3. Runbook : décrit comment vérifier (`docker top ploydok-buildkitd-1` → pas de root, `docker exec … id` → uid 1000).
4. Script audit : execute les 2 checks ci-dessus + retourne exit code + rapport markdown. Branchable en CI.
5. Ne **pas** casser les builds existants (regression test : le script run-dod Nixpacks build doit toujours passer après).

**Non-goal** : pas de refonte de `buildkit.ts` côté API.

---

### Wave 4 — DoD e2e execution (séquentielle, 1 agent, ~2-4h selon résultats)

#### F — Exécuter les 11 specs DoD + patcher ce qui casse

**Prérequis** : Waves 1 + 2 + 3 mergées. Agent + API + infra up.

**Owner exclusif :**
- `apps/web/e2e/dod/*.spec.ts` (modifications uniquement si un test est mal écrit)
- `project-docs/roadmap/sprint-3-DoD.md` (auto-généré par le script)
- Patches ciblés dans `apps/api` ou `agent/` **uniquement pour fixer ce qui est cassé** — chaque patch = 1 commit distinct avec message `fix(sprint-3-dod): <item>`.

**Tâches :**
1. `make infra-up` + demander à l'utilisateur de lancer `make dev-agent` et `make dev` (user owns les long-runs).
2. Installer le GitHub App sur un compte de test (pré-requis humain unique, doc runbook à jour).
3. `PLOYDOK_E2E_REAL=1 bun scripts/run-dod.ts`.
4. Pour chaque item rouge : stack trace → hypothèse → fix minimal → re-run cet item isolé → commit.
5. Mettre à jour `sprint-3-DoD.md` automatiquement via le script.
6. Rapport final : tableau avec durée + mesure pour chaque item, screenshot optionnel du dashboard monitoring pendant le run zero-downtime.

**Critères de succès** :
- 11/11 verts.
- Mesure concrète pour items chiffrés (build cache ratio, 5xx count, rollback duration, logs latency p95).

**Non-goal** : ne pas élargir le scope (pas de nouveau test, pas de refacto).

---

## Ordre d'exécution recommandé

```
Wave 1 (A, B, C en parallèle) ──┐
Wave 2 (D)                       ├─── merge → Wave 4 (F)
Wave 3 (E)                      ─┘
```

Durée cumulée estimée : **4-6h** si les e2e passent du premier coup, **8-12h** si correctifs nécessaires.

---

## Definition of Done global

- [ ] `requireSecondFactor` appliqué sur tous les endpoints listés Wave 2.
- [ ] Healthcheck `start_period` respecté (test unitaire vert).
- [ ] Nixpacks `--cache-from/to` présent (test unitaire + mesure à la main sur un 2ᵉ build → ratio < 0.40).
- [ ] Widget `RegistryUsage` + bouton `Prune now` visibles sur `/apps/$id/overview`.
- [ ] Script `scripts/audit-rootless.sh` retourne 0 et est branché dans `turbo typecheck` ou équivalent.
- [ ] `PLOYDOK_E2E_REAL=1 bun scripts/run-dod.ts` : **11/11 verts**, `project-docs/roadmap/sprint-3-DoD.md` régénéré avec statuts ✅.
- [ ] `bun run typecheck && bun run lint && bun test && bun run check:spdx` verts.
- [ ] Pas de push sans autorisation utilisateur (convention projet).

---

## Non-couvert (délibérément)

- **Sprint 3bis** (multi-source GitLab/Gitea + Docker image + quotas + network-isolation-per-project) — sprint dédié séparé, gros scope.
- **Sprint 4** (secrets chiffrés scopés, domaines + wildcard TLS + DNS-01, DB one-click, rotation orchestrée, backups S3/age, deploy hooks) — sprint dédié séparé.
- **Refonte `/apps/$id/*`** : `PLAN-app-detail-refonte.md` est en cours / déjà appliqué — ne pas re-toucher ici.
- **GitHub App** : `apps/api/src/github/manifest.ts` + `installation-tokens.ts` existent. Si l'UI "Install" n'est pas finalisée, c'est un follow-up du `PLAN-sprint-4.md`, pas de ce plan.
- **Sprint 5/6** (Copilot, hardening release) — hors scope.

---

## Checklist pré-lancement

- [ ] Git worktree propre ou commit en cours revu.
- [ ] `make dev` + `make dev-agent` + `make infra-up` tournent (user-owned).
- [ ] Ports 4000/5173/5000/8180/8543/2020 libres ou stables.
- [ ] L'agent Rust a été restart après le fix de ce matin (cache monitoring evicté).
