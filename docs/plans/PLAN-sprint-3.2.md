# PLAN-sprint-3.2 — Stack Classifier & Managed Docker Recipes

**Sprint** : 3.2
**Statut** : ⏳ À faire
**Source** : audit 2026-04-24 (dokploy + coolify + fixtures MakFly)

---

## Contexte

Dokploy et Coolify ne font aucune détection statique à l'import d'un repo : tous deux défaultent à `nixpacks` et laissent l'utilisateur choisir manuellement. Pour PHP, Coolify a un patch post-détection (`laravel_finetunes()` — `/tmp/coolify/app/Jobs/ApplicationDeploymentJob.php:2337-2342`), Dokploy propose Railpack en alternative manuelle, mais **aucun** ne fournit de Dockerfile production-grade managé. C'est précisément le trou qu'on remplit.

Ploydok a déjà un avantage : `CreateAppModal.tsx:127-135` sonde `Dockerfile` en temps réel et pré-sélectionne le build method. On étend ce mécanisme en classifier multi-signal + bibliothèque de recipes.

---

## Architecture cible

```
╔════════════════════════ Wizard CreateApp (apps/web) ════════════════════════╗
║ Step 2 Repo + branch                                                        ║
║       │                                                                     ║
║       ▼                                                                     ║
║  useStackClassification(fullName, branch)                                   ║
║   ├─ 15 useGitHubFileExists en parallèle                                    ║
║   └─ classifyStack(probes) → { stack, framework, confidence, recommendedBuild, recommendedRecipe, warnings } ║
║                                                                             ║
║ Step 3 bloc "Detected" + 3 cartes (Dockerfile · Recipe · Nixpacks)          ║
║        + Advanced (Compose, Railpack)                                       ║
╚═══════════════════════════════════│═════════════════════════════════════════╝
                                    ▼ POST /apps + buildMethod + recipeId?
╔════════════════════════ Worker deploy (apps/api) ═══════════════════════════╗
║  cloneRepo → detectBuildMethod (retire la logique, on fait confiance à     ║
║              buildMethod persisté en DB)                                    ║
║   ├─ dockerfile → BuildKit (Dockerfile user) — existant                     ║
║   ├─ recipe     → renderRecipe() écrit files dans build ctx → BuildKit      ║
║   ├─ compose    → reporté sprint 3.3                                        ║
║   ├─ nixpacks   → existant (fallback)                                       ║
║   └─ railpack   → reporté sprint 3.3                                        ║
╚═════════════════════════════════════════════════════════════════════════════╝
```

---

## Fichiers clés (existants) à modifier

| Fichier | Modif |
|---|---|
| `packages/shared/src/index.ts` | Exporter stack-classifier types + fonction |
| `packages/shared/src/apps.ts` | Étendre Zod `BuildMethod` avec `dockerfile`, `recipe`, `compose`, `railpack` |
| `packages/db/src/schema/apps.ts` | Migration : enum buildType étendu + colonnes `recipe_id`, `recipe_version` |
| `apps/web/src/lib/github.ts` | Pas de changement (hook existant réutilisé) |
| `apps/web/src/components/apps/CreateAppModal.tsx` | Step 3 : remplacer sondes Dockerfile par `useStackClassification`, bloc Detected, 3 cartes |
| `apps/api/src/routes/apps.ts:299` | Accepter nouvelles valeurs + validation `recipeId` cohérente |
| `apps/api/src/worker/handlers/deploy.ts:211` | Dispatcher `recipe` → renderer + BuildKit |
| `apps/api/src/worker/detect.ts:36` | Deprecate (legacy Dockerfile detection) — on fait confiance au `buildMethod` choisi au wizard |

## Fichiers nouveaux

| Fichier | Rôle |
|---|---|
| `packages/shared/src/stack-classifier.ts` | Types `Stack`, `StackClassification`, `ProbeResults` + fonction pure |
| `packages/shared/src/stack-classifier.test.ts` | Tests unitaires bun (~20 cas) |
| `apps/web/src/lib/stack-classifier-hook.ts` | `useStackClassification(fullName, branch)` |
| `packages/recipes/package.json` | Nouveau workspace |
| `packages/recipes/src/index.ts` | `renderRecipe(id, version, vars)` → `{ files: Record<string, string> }` |
| `packages/recipes/src/registry.ts` | Map `recipeId → RecipeDefinition` |
| `packages/recipes/recipes/php-laravel/v1/recipe.yaml` | Metadata (php version, extensions, node version si Vite) |
| `packages/recipes/recipes/php-laravel/v1/Dockerfile.tmpl` | Multi-stage : composer+node build → php-fpm+nginx |
| `packages/recipes/recipes/php-laravel/v1/nginx.conf.tmpl` | Laravel-aware routing |
| `packages/recipes/recipes/php-laravel/v1/entrypoint.sh` | migrations, cache warm |
| idem `php-symfony/v1/` | |
| idem `php-generic/v1/` | |

---

## Découpage par tranche

### Tranche A — Classifier (fonction pure)

**DoD** :
- Types + fonction dans `packages/shared/src/stack-classifier.ts`
- Tests `bun test packages/shared/src/stack-classifier.test.ts` verts
- Couvre Laravel, Symfony, PHP, Next, Node, Django/Flask/FastAPI/Python, Go, Rust, Ruby, Elixir, Java, Compose, Static, Unknown

**Sondes (15 HEAD requests)** :
```
Dockerfile · compose.yaml · compose.yml · docker-compose.yml ·
composer.json · artisan · symfony.lock · bin/console ·
package.json · next.config.js · next.config.mjs ·
pyproject.toml · requirements.txt · manage.py ·
go.mod · Cargo.toml · Gemfile · mix.exs · pom.xml · build.gradle ·
index.html
```

### Tranche B — Wizard UX

**DoD** :
- Hook `useStackClassification` orchestrant les 15 probes en parallèle
- Bloc "Detected" affiche `framework · signals · recommendation`
- 3 cartes visibles (Dockerfile / Recipe / Nixpacks), Compose + Railpack sous "Advanced"
- Pré-sélection automatique selon `recommendedBuild`
- Warnings affichés inline (ex: Node 18 EOL, PHP prod-grade)

### Tranche C — Enum étendu + migration DB

**DoD** :
- `BuildMethod` Zod enum étendu dans `packages/shared/src/apps.ts`
- Migration Drizzle additive générée + appliquée
- Colonnes `recipe_id` + `recipe_version` nullable
- `POST /apps` et `PATCH /apps/:id` valident que `recipeId` présent ssi `buildMethod === "recipe"`
- Alias lecture `"docker"` → `"dockerfile"` pour ne pas casser les apps existantes (on ne réécrit PAS les rows, on mappe au read)

### Tranche D — Recipes library

**DoD** :
- Workspace `packages/recipes/` créé et exposé dans `package.json` racine
- Renderer avec Handlebars (dep mature, safe par défaut)
- Recipe `php-laravel.v1` :
  - PHP 8.3, extensions: pdo, pdo_pgsql, pdo_mysql, mbstring, gd, opcache, intl, bcmath, zip
  - Si `package.json` présent : stage build Node → copie `public/build`
  - php-fpm tuné (pm=dynamic, workers raisonnables)
  - nginx routing Laravel (try_files + front controller)
  - entrypoint : `php artisan migrate --force` si `APP_ENV === production`
- Recipe `php-symfony.v1` :
  - PHP 8.4, extensions: pdo_pgsql, intl, opcache, iconv
  - composer install --no-dev --optimize-autoloader
  - nginx routing Symfony (front controller `public/index.php`)
  - entrypoint : `bin/console doctrine:migrations:migrate --no-interaction`
- Recipe `php-generic.v1` : php-fpm+nginx, public dir configurable (default `public/`)
- Tests : rendu snapshot + build BuildKit sur les 2 fixtures MakFly → 200 OK HTTP

### Tranche E — Worker intégration

**DoD** :
- `handleDeploy` : branche `buildMethod === "recipe"` → charge definition via `registry`, appelle renderer avec vars (PHP_VERSION, NODE_VERSION, ROOT_DIR…), écrit dans build context cloné, délègue à `buildImage` (BuildKit) comme pour un Dockerfile normal
- Logs streamés (pas de régression vs Dockerfile)
- Test e2e : deploy Laravel fixture → container up → healthcheck `/` renvoie 200

---

## Variables & conventions recipes

- Chaque recipe expose un `schema.json` pour ses vars. Valeurs par défaut dans `recipe.yaml`.
- Vars communes : `PHP_VERSION`, `NODE_VERSION`, `ROOT_DIR`, `BUILD_CMD`, `START_CMD`.
- User peut surcharger via env vars de l'app (préfixe `PLOYDOK_RECIPE_<NAME>`).
- Recipe versionnée : `id@version`, stockée dans DB. Pas d'auto-upgrade silencieux. `php-laravel.v1` stable jusqu'à `v2`.

---

## Points de vigilance

1. **Templating** : Handlebars (safe par défaut, pas d'eval). Pas de regex maison.
2. **Cache BuildKit** : les layers des recipes sont réutilisés entre apps → gain massif sur deploys 2+. Nom de build context stable incluant recipe version.
3. **Tests de recipes** : CI doit builder chaque recipe contre une fixture référence + healthcheck HTTP. Sans ça, on offre du matériel cassé aux users.
4. **Backcompat** : pas de migration destructive. Apps existantes en `"docker"` ou `"nixpacks"` continuent de tourner sans changement. Nouveau `"recipe"` uniquement opt-in.
5. **Sécurité** : recipes ne doivent JAMAIS exécuter de code user au build pour générer le Dockerfile. Rendu déterministe à partir de metadata seulement.
6. **Monorepo** : `ROOT_DIR` permet à une recipe de cibler un sous-dossier. Même règle que `rootDir` existant sur les apps.

---

## Vérification (E2E sprint)

1. Repo `MakFly/fixture-laravel-web` dans le wizard :
   - Bloc Detected : `Laravel 11 · composer.json · artisan · package.json · Recommended: Recipe php-laravel.v1`
   - Recipe pré-sélectionnée, utilisateur click "Deploy"
   - Build BuildKit réussi (logs streamés), image push registry local
   - Container up, `curl http://fixture-laravel.demo.ploydok.local:8180/` → 200 + HTML Laravel
2. Repo `MakFly/fixture-symfony-api` dans le wizard :
   - Bloc Detected : `Symfony · composer.json · symfony.lock · bin/console · Recommended: Recipe php-symfony.v1`
   - Recipe pré-sélectionnée, deploy OK
   - `curl` → 200 + JSON API Platform
3. Repo `fixture-hello` (Node, pas PHP) :
   - Bloc Detected : `Node · package.json · Recommended: Nixpacks`
   - Nixpacks pré-sélectionné (fallback inchangé)
   - Deploy OK, pas de régression
4. Tests unit + integration + Playwright e2e dans CI, tous verts.
