# PLAN — Build Strategy v2 : iso Dokploy/Coolify + auto-injection framework-aware

**Status** : ready for team-impl
**Parent** : refonte build strategy amorcée au sprint 3.2bis (drop recipes TS, aligner sur Nixpacks).

---

## Diagramme

```
╔════════════════════════ CreateAppModal / PATCH /apps/:id ════════════════════════╗
║                                                                                  ║
║  User repo → GitHub probe → classifyStack() ──▶ ClassifcationResult              ║
║                                                 { stack, recommendedBuild,       ║
║                                                   suggestedEnvVars: {…} }        ║
║                                                                                  ║
║                                                         │                        ║
║  INSERT apps + auto-upsertEnvVars(suggestedEnvVars)  ◀──┘                        ║
║                                                                                  ║
╚══════════════════════════════════════════════════════════════════════════════════╝
                                         │
                                         ▼
╔═══════════════════════════ worker/handlers/deploy.ts ════════════════════════════╗
║                                                                                  ║
║  build_method=nixpacks  → nixpacksBuild()  (binaire Nix, nginx template)         ║
║  build_method=railpack  → railpackBuild()  (binaire Go, Caddy template)  [W3]    ║
║  build_method=dockerfile → buildImage() via BuildKit                             ║
║  build_method=compose   → FatalDeployError (sprint 3.3)                          ║
║                                                                                  ║
╚══════════════════════════════════════════════════════════════════════════════════╝

── Référence sourcée ──
  Nixpacks  : github.com/railwayapp/nixpacks/tree/main/src/providers (24 providers)
  Railpack  : github.com/railwayapp/railpack/tree/main/core/providers (15 providers, Caddy)
  Coolify   : coolify.io/docs/applications/symfony (documente les 2 env vars, automatise pas)
  Dokploy   : docs.dokploy.com/docs/core/applications/build-type (5 build types,
              zéro middleware framework-aware)
  Symfony   : frankenphp.dev/docs/production (recommandation officielle 2026 =
              dunglas/frankenphp + runtime/frankenphp-symfony)
```

---

## Context

### Ce qui a été fait avant ce plan

- Commit `7ec84a2` (recipe FrankenPHP TS) → reverted.
- Commit `deb6a5e` : `packages/recipes/` supprimé, `buildMethod=recipe` retiré de l'API, migration DB `0018` convertit apps existantes en `nixpacks`.
- `project-docs/fixtures/symfony-references/` : 4 fichiers de référence prod-grade créés (Dockerfile FrankenPHP + Caddyfile + entrypoint + nixpacks.toml + README).
- Image `127.0.0.1:5000/fixture-symfony-frankenphp:latest` buildée et pushée au registry local.
- 2 branches poussées sur `MakFly/fixture-symfony-api` :
  - `feat/frankenphp-deploy` (Dockerfile + Caddyfile + entrypoint) — **à garder**.
  - `feat/nixpacks-config` (nixpacks.toml seul) — **trompeur**, à supprimer.

### Ce que la recherche a révélé (faits sourcés)

1. **Nixpacks PHP est Laravel-only nativement** : seul `artisan` déclenche une détection framework dédiée (code : [`src/providers/php/mod.rs`](https://github.com/railwayapp/nixpacks/blob/main/src/providers/php/mod.rs)). Pour Symfony, la stack compile mais le nginx template ne rewrite pas vers `index.php` sans 2 variables :
   - `NIXPACKS_PHP_ROOT_DIR=/app/public`
   - `NIXPACKS_PHP_FALLBACK_PATH=/index.php`
2. **Coolify documente la fix** ([coolify.io/docs/applications/symfony](https://coolify.io/docs/applications/symfony)) mais **ne l'automatise pas** — le user doit saisir les 2 vars manuellement.
3. **Dokploy ne fait aucun middleware framework-aware** — passe le repo brut à Nixpacks/Railpack ([docs.dokploy.com/build-type](https://docs.dokploy.com/docs/core/applications/build-type)).
4. **Railpack** = successor officiel de Nixpacks par Railway (2024+), écrit en Go, **utilise Caddy au lieu de nginx** pour PHP. Dokploy le supporte ([docs.railway.com/builds/railpack](https://docs.railway.com/builds/railpack)).
5. **Recommandation Symfony 2026** : `dunglas/frankenphp` + `runtime/frankenphp-symfony` + mode worker. Symfony 7.4 ships avec support FrankenPHP natif ([frankenphp.dev/docs/production](https://frankenphp.dev/docs/production)).

### Outcome visé

Ploydok devient **framework-aware dynamiquement**, ce que ni Dokploy ni Coolify ne font :

- Symfony / Rails / Django etc. détectés → env vars PaaS auto-injectées au CREATE/PATCH.
- Zéro config côté user repo pour que Nixpacks tourne sur ces stacks.
- FrankenPHP reste le path prod haute-perf (Dockerfile user fourni, one-click injection à venir).
- Railpack devient un path first-class (pas juste un enum rejeté).

Différenciation réelle vs Dokploy/Coolify, sourcée, pas inventée.

---

## Waves

### Wave 1 — Cleanup + validation live (quick wins, parallèle)

**T1.1 — Supprimer la branche `feat/nixpacks-config`**

- `gh api -X DELETE /repos/MakFly/fixture-symfony-api/git/refs/heads/feat/nixpacks-config`
- Justification : le nixpacks.toml seul ne corrige pas le routing Symfony sans les 2 env vars. Laisser la branche mènerait à de la confusion. La fix correcte passe par l'auto-injection côté Ploydok (wave 2) — l'utilisateur final n'a RIEN à committer dans son repo.

**T1.2 — Valider live le path FrankenPHP**

- Créer une app Ploydok `fixture-symfony-franken` :
  - `gitProvider = "image"`, `imageRef = "127.0.0.1:5000/fixture-symfony-frankenphp:latest"`
  - `healthcheck.path = "/api"`
  - Env vars : `APP_SECRET` (openssl rand -hex 32), `DATABASE_URL=postgresql://…`
- Trigger deploy, attendre status `running`.
- Vérifier :
  - `curl http://fixture-symfony-franken.demo.ploydok.local:8180/api` → 200 JSON-LD Hydra entrypoint
  - `docker exec <container> frankenphp version` → imprime la version
  - `docker logs <container>` → zéro "child said into stderr" (car pas de php-fpm)
  - Benchmark léger : `hey -n 500 -c 10 http://…/api` — reporter p50/p99

**T1.3 — Update `project-docs/fixtures/symfony-references/README.md`**

- Ce nouveau message : Ploydok auto-injecte les env vars Nixpacks pour Symfony (wave 2), donc le user a uniquement **deux** chemins réels :
  1. **Nixpacks géré par Ploydok** (par défaut) — classifier détecte Symfony, pose les env vars, ça marche.
  2. **FrankenPHP via Dockerfile custom** (prod haute-perf) — trois fichiers à commit (`Dockerfile`, `Caddyfile`, `docker-entrypoint.sh`).
- Supprimer le chapitre "Nixpacks + nixpacks.toml" naïf qui laissait entendre que le fichier seul suffisait.
- Garder le benchmark p50/p99 comparatif + source officielle FrankenPHP.
- Ajouter un lien vers l'ADR wave 4.

---

### Wave 2 — Classifier framework-aware + auto-injection env vars (coeur)

**T2.1 — Étendre `StackClassification`**
Ajouter un champ `suggestedEnvVars: Record<string, string>` au type (`packages/shared/src/stack-classifier.ts`).

Pour chaque stack :

- **Symfony** (symfony.lock | bin/console) → `{ NIXPACKS_PHP_ROOT_DIR: "/app/public", NIXPACKS_PHP_FALLBACK_PATH: "/index.php", APP_ENV: "prod" }`
- **Laravel** (artisan) → `{}` (Nixpacks le gère déjà nativement)
- **Django** (manage.py) → `{ PYTHON_VERSION: "3.12" }` (optionnel, aligné sur Nixpacks default)
- **Rails** (Gemfile + config.ru) → `{ RAILS_ENV: "production", RAILS_SERVE_STATIC_FILES: "true" }`
- Autres : `{}` par défaut.

**T2.2 — Auto-inject côté API**
Dans `apps/api/src/routes/apps.ts` `POST /apps` :

- Après l'`insertApp()`, si `body.buildMethod ∈ {nixpacks, railpack, auto}` ET qu'on peut classifier le repo (appel au classifier avec les probes existantes depuis github.ts), récupérer `suggestedEnvVars` et faire un `upsertEnvVars(db, newApp.id, [...suggestedEnvVars])` avant de renvoyer la réponse.
- Pas d'override si l'user a déjà posé une var manuelle du même nom.

Note : le classifier côté `packages/shared` est pure. On lui passe les probes — l'API doit les fetcher via `github.ts.fileExists()` (helpers existants).

**T2.3 — Tests**

- `packages/shared/src/stack-classifier.test.ts` : ajouter un `describe("suggestedEnvVars")` qui vérifie pour chaque stack les vars correctes.
- `apps/api/src/routes/apps.test.ts` : test d'intégration POST /apps avec mock GitHub qui renvoie `symfony.lock` → vérifier que les env vars sont bien créées en DB.

---

### Wave 3 — Railpack first-class + `nixpacks plan` pre-check

**T3.1 — Débloquer `buildMethod: railpack`**

- Retirer le `FatalDeployError` dans `apps/api/src/worker/handlers/deploy.ts:251` (ligne actuelle).
- Créer `apps/api/src/worker/railpack.ts` jumeau de `nixpacks.ts` :
  - Download binary depuis [github.com/railwayapp/railpack/releases](https://github.com/railwayapp/railpack/releases) (Go binary) au premier usage.
  - Wrapper `railpack build <workspacePath> --output=<dir>` via `Bun.spawn`.
- Câbler dans deploy.ts : `resolvedBuildMethod === "railpack"` → appelle `railpackBuild()`.

**T3.2 — `nixpacks plan` comme pre-check côté worker**

- Avant `nixpacksBuild()`, lancer `nixpacks plan --format=json <workspacePath>`.
- Parse le JSON : si `providers` est vide → `FatalDeployError("Nixpacks ne détecte aucun framework. Fournissez un Dockerfile ou sélectionnez compose.")`.
- Si `providers[].name == "php"` ET absence de `NIXPACKS_PHP_*` dans l'env container → émettre un **warning log** (pas bloquant) "Symfony-like PHP detected but fallback-path not set — Ploydok auto-injection a-t-elle bien tourné ?"
- Reference bug Nixpacks : [nixpacks#1241](https://github.com/railwayapp/nixpacks/issues/1241) — le plan peut cracher du bruit avant le JSON. Parser ligne par ligne jusqu'au premier `{`.

**T3.3 — UI : surface le classifier + les env vars injectées**

- Dans `CreateAppModal.tsx` step 3, si le classifier remonte `suggestedEnvVars`, afficher une note "Ploydok configurera automatiquement ces variables pour que $framework tourne sous Nixpacks : X=Y, Z=W. Modifiable après création."
- Pas de toggle pour désactiver (always-on). L'user peut les éditer dans `/env` post-création.

---

### Wave 4 — ADR + docs + sprint tracking

**T4.1 — ADR `project-docs/decisions/0004-build-strategy.md`**
Contenu obligatoire :

- État avant : recipes TS hardcodées (sprint 3.2).
- État après : Nixpacks + Railpack + Dockerfile, zéro recipe maison, framework-aware via auto-injection d'env vars.
- Comparaison sourcée iso Dokploy / Coolify (tableau).
- Pourquoi pas Heroku buildpacks natifs (hors-scope MVP, surface Docker suffit).
- Pourquoi pas fork Nixpacks (cost PR upstream > bénéfice).

**T4.2 — Update `project-docs/roadmap/sprint-3.2-stack-classifier-recipes.md`**

- Statut titre : `⚠️ Partiel · pivoté vers Nixpacks/Railpack`.
- Ajouter § "Post-mortem" pointant vers ce PLAN et l'ADR 0004.

**T4.3 — Update `project-docs/roadmap/README.md`**

- Tableau sprint : statut sprint 3.2 = `⚠️ Pivoté` avec référence au présent plan.

---

## Critical files

| Fichier                                                    | Wave | Action                                   |
| ---------------------------------------------------------- | ---- | ---------------------------------------- |
| `project-docs/fixtures/symfony-references/README.md`               | W1   | Rewrite — supprime path Nixpacks naïf    |
| (GitHub) `MakFly/fixture-symfony-api:feat/nixpacks-config` | W1   | Delete via `gh api`                      |
| `packages/shared/src/stack-classifier.ts`                  | W2   | + `suggestedEnvVars` par stack           |
| `packages/shared/src/stack-classifier.test.ts`             | W2   | + describe suggestedEnvVars              |
| `apps/api/src/routes/apps.ts`                              | W2   | auto-upsert envVars au POST /apps        |
| `apps/api/src/routes/apps.test.ts`                         | W2   | test intégration                         |
| `apps/api/src/worker/handlers/deploy.ts`                   | W3   | branche railpack + nixpacks plan pre-run |
| `apps/api/src/worker/railpack.ts`                          | W3   | **nouveau** — wrapper Railpack           |
| `apps/web/src/components/apps/CreateAppModal.tsx`          | W3   | afficher suggestedEnvVars                |
| `project-docs/decisions/0004-build-strategy.md`                          | W4   | **nouveau**                              |
| `project-docs/roadmap/sprint-3.2-stack-classifier-recipes.md`      | W4   | post-mortem                              |
| `project-docs/roadmap/README.md`                                   | W4   | statut                                   |

---

## Verification (global)

### Static + unit

```bash
bunx tsc -p apps/api/tsconfig.json --noEmit
bunx tsc -p apps/web/tsconfig.json --noEmit
bun test packages/shared/
bun test apps/api/
bun run check:spdx
```

### Live

1. **FrankenPHP live (W1.2)** — `curl http://fixture-symfony-franken.demo.ploydok.local:8180/api` → 200 JSON-LD.
2. **Auto-inject Nixpacks Symfony (W2)** — POST une nouvelle app sur `MakFly/fixture-symfony-api:main` avec `buildMethod=nixpacks`, zéro env var custom. Deploy. Vérifier que `/api` répond 200 (les env vars ont été auto-injectées). Inspecter `GET /apps/:id/env` → contient `NIXPACKS_PHP_*`.
3. **Railpack first-class (W3)** — POST app avec `buildMethod=railpack`, vérifier que le binaire se télécharge + build réussit.
4. **Régression négative** — POST avec `recipeId` dans le body → rejeté avec `unrecognized_key`.

### Cleanup

```bash
docker ps -a --filter "name=ploydok-app-e2e-" --filter "name=ploydok-app-iso-" -q | xargs -r docker rm -f
```

---

## Not in scope (explicit)

- PR Preview Environments (feature future — source : [Railway Environments](https://docs.railway.com/environments)).
- Auto-detect healthcheck depuis `routes.yaml` / `symfony/health-check-bundle`.
- Service Templates data-first façon Coolify (packages/service-templates/).
- One-click "Inject FrankenPHP in this repo" via PR GitHub.
- AI pre-build analysis du `nixpacks plan` (feature différenciante vs Dokploy v0.29 post-mortem).
- Heroku / Paketo buildpacks natifs.

Chacun de ces items mérite son propre sprint — listés ici pour traçabilité.

---

## Sources

- Nixpacks providers snapshot : [github.com/railwayapp/nixpacks/tree/main/src/providers](https://github.com/railwayapp/nixpacks/tree/main/src/providers)
- Nixpacks PHP code : [src/providers/php/mod.rs](https://github.com/railwayapp/nixpacks/blob/main/src/providers/php/mod.rs)
- Nixpacks CLI : [nixpacks.com/docs/cli](https://nixpacks.com/docs/cli)
- Railpack providers : [github.com/railwayapp/railpack/tree/main/core/providers](https://github.com/railwayapp/railpack/tree/main/core/providers)
- Railpack vs Nixpacks : [docs.railway.com/builds/railpack](https://docs.railway.com/builds/railpack)
- Coolify Symfony docs (documente les 2 env vars) : [coolify.io/docs/applications/symfony](https://coolify.io/docs/applications/symfony)
- Dokploy build types : [docs.dokploy.com/docs/core/applications/build-type](https://docs.dokploy.com/docs/core/applications/build-type)
- Dokploy v0.29 AI post-mortem : [dokploy.com/blog/v0-29-0-ai-powered-debugging](https://dokploy.com/blog/v0-29-0-ai-powered-debugging-mcp-server-cli-shared-git-providers)
- FrankenPHP prod docs : [frankenphp.dev/docs/production](https://frankenphp.dev/docs/production)
- `runtime/frankenphp-symfony` : [packagist.org/packages/runtime/frankenphp-symfony](https://packagist.org/packages/runtime/frankenphp-symfony)
- dunglas/symfony-docker : [github.com/dunglas/symfony-docker](https://github.com/dunglas/symfony-docker)
