# Sprint 3.2 — Stack Classifier & Managed Docker Recipes ⚠️ Pivoté (classifier gardé, recipes dropées)

> **Post-mortem 2026-04-24** : le système de recipes hardcodées en TypeScript
> a été abandonné après validation empirique. Personne dans l'écosystème
> self-hosted ne fait ça (Dokploy délègue tout à Nixpacks/Railpack, Coolify
> pareil). Les 4 recipes PHP livrées dupliquaient exactement ce que Nixpacks
> produit et n'étaient même pas exposées dans le wizard. Voir :
>
> - `docs/plans/PLAN-build-strategy-v2.md` (plan d'exécution du pivot)
> - `docs/adr/0004-build-strategy.md` (décision architecturale)
>
> Ce qui a été **conservé** du sprint 3.2 : le classifier (`packages/shared/src/stack-classifier.ts`).
> Il a été enrichi avec `suggestedEnvVars` qui automatisent la config Symfony
> sous Nixpacks — différenciation réelle vs Coolify (qui documente les env
> vars mais demande à l'utilisateur de les saisir) et Dokploy (aucun
> middleware framework-aware).
>
> Ce qui a été **supprimé** : `packages/recipes/`, `'recipe'` du
> `BuildMethodSchema`, colonnes `recipe_id` / `recipe_version` / `recipe_vars`
> (migration DB `0018`).
>
> Ce qui a été **ajouté** en conséquence : Railpack comme build path
> first-class, pre-check `nixpacks plan` avant build, Dockerfile FrankenPHP
> de référence dans `docs/fixtures/symfony-references/` pour l'option
> prod haute-perf.

**Durée** : 1 semaine
**Objectif** : battre Dokploy et Coolify sur la détection de stack à l'import et sur le support PHP/Laravel/Symfony production-grade — **sans que l'utilisateur ait à écrire un Dockerfile**.
**Dépendances** : Sprints 3 (deploy-from-git) et 3bis (multi-source) terminés.

---

## Contexte

Audit 2026-04-24 : Dokploy et Coolify ne font **aucune détection statique** du repo à l'import. Les deux défaultent à `nixpacks` et laissent l'utilisateur choisir manuellement le build type. Pour PHP, Coolify a un post-processing Laravel spécifique (`laravel_finetunes()` — inject `NIXPACKS_PHP_FALLBACK_PATH`), Dokploy a Railpack comme alternative optionnelle, mais aucun ne propose de Dockerfile production-grade managé.

Ploydok a déjà une longueur d'avance : le wizard sonde `Dockerfile` statiquement et pré-sélectionne le build method. On capitalise là-dessus pour :

1. **Classifier multi-signal** : 15 sondes parallèles via `/github/file-exists` déjà existant, fonction pure `classifyStack(probes)` → `{ stack, framework, confidence, recommendedBuild, warnings }`.
2. **Managed Docker Recipes** : bibliothèque de Dockerfiles multi-stage (php-fpm+nginx pour Laravel/Symfony, distroless Node pour Next, gunicorn pour Django, …) rendus dans le build context temporaire — zéro pollution du repo user.
3. **Enum `buildMethod` étendu** : `auto | dockerfile | recipe | compose | nixpacks | railpack`.
4. **UX wizard** : bloc "Detected" explicite (framework, signals, recommandation) + 3 cartes principales (Dockerfile / Recipe / Nixpacks) + Advanced (Compose, Railpack).

Détail stratégique complet : `docs/plans/PLAN-sprint-3.2.md`.

---

## Scope

### 3.2.1 — Classifier (fonction pure)

- [ ] `packages/shared/src/stack-classifier.ts` : types + fonction `classifyStack(probes)`
- [ ] Couvre : Laravel, Symfony, PHP générique, Next, Node, Python (Django/Flask/FastAPI/générique), Go, Rust, Ruby, Elixir, Java, Compose, Static, Unknown
- [ ] Tests `bun test` — 100% pure, zéro réseau, cas nominaux + ambigus (ex: `composer.json` + `package.json` → Laravel + Vite)
- [ ] Export via `packages/shared/src/index.ts`

### 3.2.2 — Wizard : bloc "Detected" + 3 cartes

- [ ] `apps/web/src/lib/stack-classifier-hook.ts` : `useStackClassification(fullName, branch)` — parallélise 15 `useGitHubFileExists` et appelle le classifier
- [ ] `CreateAppModal.tsx` Step 3 : bloc "Detected" (framework + signals + recommandation) au-dessus des cartes
- [ ] 3 cartes : Dockerfile (your own) · Recipe (managed) · Nixpacks (fallback). Compose + Railpack en Advanced.
- [ ] Warnings inline (ex: "PHP: managed Recipe recommandée pour prod-grade php-fpm+nginx")
- [ ] Pré-sélection basée sur `recommendedBuild`

### 3.2.3 — Enum buildMethod étendu + DB

- [ ] Zod schema `BuildMethod` dans `packages/shared/` : `"auto" | "dockerfile" | "recipe" | "compose" | "nixpacks" | "railpack"`
- [ ] Migration Drizzle : additive, `"docker"` → alias/migration vers `"dockerfile"`
- [ ] Nouveaux champs apps : `recipeId` (text nullable), `recipeVersion` (text nullable)
- [ ] POST /apps accepte les nouvelles valeurs, valide que `recipeId` est présent ssi `buildMethod === "recipe"`

### 3.2.4 — Recipes library

- [ ] Nouveau workspace `packages/recipes/`
- [ ] Structure par recipe : `recipe.yaml` (metadata, vars), `Dockerfile.tmpl`, `nginx.conf.tmpl` si web, `entrypoint.sh`
- [ ] Première livraison : `php-laravel.v1`, `php-symfony.v1`, `php-generic.v1`
- [ ] Renderer : `renderRecipe(recipeId, version, vars) → { files: { path: content } }`
- [ ] Tests : rendu + build effectif avec BuildKit sur les 2 fixtures MakFly

### 3.2.5 — Worker route recipe → BuildKit

- [ ] `apps/api/src/worker/handlers/deploy.ts` : branch `buildMethod === "recipe"` → appeler renderer, écrire dans build context, passer à `buildImage` (BuildKit) comme pour un Dockerfile normal
- [ ] Logs streamés sans régression vs Dockerfile
- [ ] Variables injectées automatiquement : `PHP_VERSION` par défaut selon recipe, overridable via env vars app

### 3.2.6 — Validation bout-en-bout (DoD)

- [ ] `MakFly/fixture-laravel-web` → classifier dit `laravel`, recipe `php-laravel.v1` déployé, app répond 200 sur `/`
- [ ] `MakFly/fixture-symfony-api` → classifier dit `symfony`, recipe `php-symfony.v1` déployé, app répond 200 sur `/`
- [ ] Nixpacks reste le fallback : `fixture-hello` (Node) continue de déployer en nixpacks sans régression
- [ ] Test e2e Playwright : parcours wizard complet avec bloc Detected + sélection recipe + deploy

---

## Non-couvert (explicit hors-scope)

- Compose en resource first-class (à la Dokploy — gros refacto DB) → reporté **Sprint 3.3**
- Railpack comme alternative nixpacks → reporté **Sprint 3.3** (flag expérimental)
- Recipes Python/Go/Rust/Ruby/Java → reporté **Sprint 3.3**
- Versioning/rollback des recipes via UI → reporté Sprint 6 (hardening)
- Recipe editor/custom dans l'UI → post-v1

---

## Risques

| Risque                                                           | Probabilité | Mitigation                                                                            |
| ---------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------- |
| Renderer de template fragile (escaping, substitution)            | Moyen       | Choisir Handlebars (mature) plutôt que custom regex                                   |
| Recipes PHP mal tunées pour prod (opcache, workers)              | Élevé       | CI build + smoke test HTTP contre fixtures MakFly dès N+3                             |
| Migration enum buildMethod casse les apps existantes             | Élevé       | Migration additive + alias `"docker"` → `"dockerfile"` en lecture, jamais en écriture |
| Classifier trop confiant (ex: `composer.json` dans un repo Node) | Faible      | Champ `confidence` + fallback recommandation `"auto"` en cas d'ambiguïté              |
| 15 HEAD requests ralentissent le wizard                          | Faible      | Parallel + `staleTime: 5min` dans react-query, cache côté Ploydok API si besoin       |

---

## DoD (Definition of Done)

- [ ] Classifier couvre les 13 stacks listées, 100% testé (bun test)
- [ ] Wizard affiche "Detected: <framework>" + recommandation correcte pour les 2 fixtures MakFly
- [ ] Enum `buildMethod` étendu, migration Drizzle appliquée, POST /apps accepte les nouvelles valeurs
- [ ] 2 recipes PHP (`php-laravel.v1`, `php-symfony.v1`) + 1 générique (`php-generic.v1`) produisent un Dockerfile qui builde et tourne
- [ ] Deploy Laravel + Symfony fixtures via recipe : 200 OK sur `/`, logs nginx+php-fpm propres
- [ ] Nixpacks fallback non régressé (fixture-hello Node toujours OK)
- [ ] Docs : `docs/adr/00XX-stack-classifier.md` + `docs/recipes.md` (comment ajouter une recipe)
- [ ] Tests : unit (classifier + renderer) + integration worker (recipe → build) + e2e Playwright (wizard)
