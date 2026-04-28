# Sprint 3.2 — Stack Classifier & Managed Docker Recipes ✅ Terminé

> **Statut : TERMINÉ** — pivot validé et clôturé 2026-04-27.
>
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

### 3.2.1 — Classifier conservé

- [x] `packages/shared/src/stack-classifier.ts` : classifier conservé
- [x] `suggestedEnvVars` ajouté pour automatiser la config Symfony sous Nixpacks
- [x] Injection des env vars suggérées sans écraser les valeurs utilisateur
- [x] Nixpacks reste le fallback principal

### 3.2.2 — Recipes dropées

- [x] `packages/recipes/` supprimé
- [x] `'recipe'` retiré du `BuildMethodSchema`
- [x] Colonnes `recipe_id` / `recipe_version` / `recipe_vars` supprimées via migration DB `0018`
- [x] ADR 0004 et `PLAN-build-strategy-v2.md` documentent le pivot

### 3.2.3 — Build strategy v2

- [x] Railpack ajouté comme build path first-class
- [x] Pre-check `nixpacks plan` avant build
- [x] Healthcheck Ploydok forcé au spawn pour éviter les `unhealthy` hérités des images baked-in
- [x] GC containers orphelins ajouté

### 3.2.4 — Validation bout-en-bout

- [x] Symfony sous Nixpacks zero-config validé
- [x] FrankenPHP validé live p50 4.9ms / p99 6.2ms
- [x] Aucun container unhealthy causé par un healthcheck hérité baked-in

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

- [x] Classifier conservé et enrichi avec `suggestedEnvVars`
- [x] Recipes TypeScript supprimées après pivot validé
- [x] Build method `recipe` et colonnes recipe retirés
- [x] Railpack first-class ajouté
- [x] Nixpacks fallback non régressé
- [x] Symfony zero-config validé sous Nixpacks
- [x] Dockerfile FrankenPHP de référence conservé dans `docs/fixtures/symfony-references/`
- [x] Décision documentée dans `docs/adr/0004-build-strategy.md` + `docs/plans/PLAN-build-strategy-v2.md`
