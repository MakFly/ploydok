# ADR 0004 — Build strategy v2 : Nixpacks + Railpack + auto-injection framework-aware

**Date**: 2026-04-24
**Status**: Accepted (sprint 3.2bis)

---

## Context

Au sprint 3.2 nous avons introduit un système de "recipes" : des modules
TypeScript hardcodés (`packages/recipes/src/recipes/*.ts`) qui généraient un
`Dockerfile` + sidecars (nginx.conf, php-fpm.conf, entrypoint.sh) via
template strings interpolés. 4 recipes existaient : `php-laravel.v1`,
`php-symfony.v1`, `php-symfony-frankenphp.v1`, `php-generic.v1`.

Une exploration sourcée a révélé que **personne ne fait ça** dans l'écosystème
self-hosted :

- **Dokploy** délègue 100% à des outils externes : Nixpacks, Railpack,
  Heroku/Paketo buildpacks, Dockerfile, Compose, Static. Zéro Dockerfile
  maison. Source : [docs.dokploy.com/docs/core/applications/build-type](https://docs.dokploy.com/docs/core/applications/build-type).
- **Coolify** : 4 build packs (Nixpacks, Dockerfile, Compose, Static). PHP /
  Laravel / Symfony → php-fpm + nginx **via Nixpacks**, pas via template maison.
  Source : [coolify.io/docs/applications/symfony](https://coolify.io/docs/applications/symfony).
- Les recipes PHP que nous avons écrites dupliquent **exactement** ce que
  Nixpacks produit, sont invisibles dans le wizard (Ploydok n'affichait que
  Dockerfile + Nixpacks), et ne montaient pas à la prod.

---

## Decisions

### 1. Dropper le système de recipes

Commits `8db8dab` (revert `php-symfony-frankenphp.v1`) + `deb6a5e` (suppression
du package `@ploydok/recipes` en entier, `'recipe'` retiré du `BuildMethodSchema`,
migration DB `0018` qui convertit les apps existantes en `nixpacks`).

Un user qui veut un Dockerfile prod-grade (FrankenPHP par exemple) le **commit
dans son repo** et choisit `buildMethod=dockerfile`. Pattern identique à
Coolify.

### 2. Auto-injecter les env vars Nixpacks framework-aware à la création

C'est **la différenciation réelle** vs Dokploy / Coolify, sourcée sur une
limitation connue :

- Nixpacks' PHP provider est Laravel-centric (source :
  [`src/providers/php/mod.rs`](https://github.com/railwayapp/nixpacks/blob/main/src/providers/php/mod.rs)).
  Seul `artisan` déclenche une détection de framework. Son nginx template ne
  rewrite vers `index.php` que si `NIXPACKS_PHP_FALLBACK_PATH` est défini.
- Coolify documente la workaround (2 env vars à poser à la main). Dokploy
  n'implémente aucun middleware.
- Ploydok les pose **automatiquement** via le stack-classifier côté API :

  | Stack détecté                            | Env vars injectées                                                                           |
  | ---------------------------------------- | -------------------------------------------------------------------------------------------- |
  | Symfony (`symfony.lock` / `bin/console`) | `NIXPACKS_PHP_ROOT_DIR=/app/public`, `NIXPACKS_PHP_FALLBACK_PATH=/index.php`, `APP_ENV=prod` |
  | Django (`manage.py`)                     | `PYTHON_VERSION=3.12`                                                                        |
  | Ruby (`Gemfile`)                         | `RAILS_ENV=production`, `RAILS_SERVE_STATIC_FILES=true`                                      |
  | Laravel / Next / autres                  | `{}` (Nixpacks gère nativement)                                                              |

Implémentation : `packages/shared/src/stack-classifier.ts` expose
`suggestedEnvVars: Record<string, string>`. `apps/api/src/routes/apps.ts`
(`POST /apps`) probe le repo via GitHub API sur `ALL_PROBE_KEYS`, classifie,
et `upsertEnvVars()` avant de renvoyer la réponse.

Commit `df189df`.

### 3. Railpack comme build path first-class

Sourcé : [docs.railway.com/builds/railpack](https://docs.railway.com/builds/railpack) +
[github.com/railwayapp/railpack](https://github.com/railwayapp/railpack).
Railpack est le successor officiel de Nixpacks par Railway depuis 2024
(Go, utilise Caddy au lieu de nginx pour PHP). Dokploy le supporte nativement.

`apps/api/src/worker/railpack.ts` suit le même pattern binary-resolution que
`nixpacks.ts` (PATH → dev cache → GitHub release). `deploy.ts` ajoute la
branche `else if (detected.method === "railpack")` qui build + push avec la
même sémantique que Nixpacks.

`compose` reste rejeté (sprint 3.3). Commit `8999ab3`.

### 4. Pre-check `nixpacks plan` avant le build

Sourcé : [nixpacks.com/docs/cli](https://nixpacks.com/docs/cli) +
[railwayapp/nixpacks#1241](https://github.com/railwayapp/nixpacks/issues/1241)
pour le bug de banner-noise avant le JSON.

Avant d'invoquer `nixpacksBuild()`, on exécute
`nixpacks plan <path> --format=json` et on parse le résultat. Si `providers`
est vide (Nixpacks ne détecte rien), on lève un `FatalDeployError` explicite
**avant** de brûler 2 minutes de build. Différenciation vs Dokploy v0.29 qui
fait de l'analyse AI **post-mortem** des logs — ici on est proactif sur le plan.

Commit `8999ab3`.

### 5. FrankenPHP via Dockerfile user-fourni (prod haute-perf)

Recommandé officiellement par Symfony depuis 7.4 (runtime/frankenphp-symfony).
Pas de recipe TS — 3 fichiers de référence dans `docs/fixtures/symfony-references/`
que les users copient dans leur repo. Worker mode, JIT tracing, Caddy sans
`try_files` dans `php_server` (pattern `dunglas/symfony-docker`).

Validé live : p50=4.9ms / p99=6.2ms sur `/api` Hydra entrypoint (50 seq GET).

---

## Rejected alternatives

### Option A — Full Nixpacks, drop recipes, FrankenPHP = user's problem

Notre premier pivot. Abandonné parce que laisser Nixpacks nu sur du Symfony
produit des 404 silencieux. Coolify a le même problème et le documente
seulement — on automatise côté serveur à la place.

### Option B — Fork Nixpacks pour y ajouter un provider `php-symfony` + FrankenPHP

Rejeté : PR upstream longue à review (Railway est en maintenance mode sur
Nixpacks depuis le lancement de Railpack), maintenance d'un fork pas rentable
pour 3 env vars.

### Option C — Heroku / Paketo buildpacks natifs

Dokploy les supporte, Coolify non. Hors scope MVP (deux workers
supplémentaires à maintenir). Sera peut-être ajouté plus tard si un user
apporte un cas d'usage précis.

### Option D — Service templates data-first façon Coolify

Le repo [`coollabsio/coolify/templates/service-templates.json`](https://github.com/coollabsio/coolify/blob/v4.x/templates/service-templates.json)
est une bonne idée pour les services tiers (Postgres, Redis, Grafana…) mais
c'est une feature orthogonale au build path. Listé comme non-goal du plan
courant, à ouvrir dans un sprint séparé.

---

## Operational notes (post-livraison)

### Healthcheck forcé au spawn

Les images de base populaires embarquent parfois un `HEALTHCHECK` qui échoue
dès qu'on s'écarte de la config par défaut. Exemple vécu : `dunglas/frankenphp`
sonde `http://localhost:2019/metrics` (Caddy admin), mais notre Caddyfile de
référence met `admin off` pour la prod → 72 échecs consécutifs observés sur un
container qui servait parfaitement du trafic.

Résolution : `apps/api/src/worker/runner.ts` **force** un healthcheck
Ploydok-owned dans le `ContainerCreateRequest` (`CMD-SHELL curl -fsS
http://127.0.0.1:$hcPort$hcPath`) qui supersède ce qui est baked dans l'image.
Invariant : un container `ploydok.kind=app` n'est `unhealthy` que quand l'app
elle-même l'est, jamais à cause d'un probe hérité stale.

### Auto-inject env vars préserve les valeurs user

Le bloc auto-inject dans `POST /apps` `list` d'abord les env vars existantes,
puis n'injecte que les clés absentes. Un user qui POST avec `APP_ENV=staging`
déjà présent voit sa valeur conservée. Les env scopes (sprint-4) continuent
d'override par environnement (`production` / `preview` / `development`).

### GC containers orphelins

`apps/api/src/worker/jobs/gc-orphan-containers.ts` tick toutes les 10 min :
tous les containers labellés `ploydok.kind=app` dont l'`app_id` n'existe plus
en DB et dont l'uptime dépasse 24h sont `force`-removed. Cible : orphans
venant de deploys crashés entre commit DB et cleanup containers, ou legacy
state d'une version antérieure de Ploydok.

---

## Files impacted

| Path                                           | Role                                   |
| ---------------------------------------------- | -------------------------------------- |
| `packages/shared/src/stack-classifier.ts`      | `suggestedEnvVars` par stack           |
| `packages/shared/src/stack-classifier.test.ts` | 8 tests suggestedEnvVars               |
| `apps/api/src/routes/apps.ts`                  | auto-inject au `POST /apps`            |
| `apps/api/src/routes/apps.test.ts`             | 5 tests intégration auto-inject        |
| `apps/api/src/worker/handlers/deploy.ts`       | branches railpack + nixpacks plan      |
| `apps/api/src/worker/nixpacks.ts`              | `nixpacksPlan()` wrapper               |
| `apps/api/src/worker/railpack.ts`              | **nouveau** — `railpackBuild()`        |
| `apps/api/src/worker/detect.ts`                | `"railpack"` dans l'union              |
| `packages/db/src/queries/builds.ts`            | `BuildMethod` inclut `"railpack"`      |
| `packages/db/migrations/0018_*.sql`            | drop `recipe_*` columns + migrate data |
| `docs/fixtures/symfony-references/*`           | 3 fichiers de référence FrankenPHP     |
| `docs/plans/PLAN-build-strategy-v2.md`         | plan d'implémentation                  |
| `docs/adr/0004-build-strategy.md`              | **ce document**                        |

---

## Sources

- Nixpacks providers : [github.com/railwayapp/nixpacks/tree/main/src/providers](https://github.com/railwayapp/nixpacks/tree/main/src/providers)
- Nixpacks PHP code : [src/providers/php/mod.rs](https://github.com/railwayapp/nixpacks/blob/main/src/providers/php/mod.rs)
- Nixpacks CLI : [nixpacks.com/docs/cli](https://nixpacks.com/docs/cli)
- Railpack : [docs.railway.com/builds/railpack](https://docs.railway.com/builds/railpack) + [github.com/railwayapp/railpack](https://github.com/railwayapp/railpack)
- Coolify Symfony docs : [coolify.io/docs/applications/symfony](https://coolify.io/docs/applications/symfony)
- Dokploy build types : [docs.dokploy.com/docs/core/applications/build-type](https://docs.dokploy.com/docs/core/applications/build-type)
- Dokploy v0.29 AI post-mortem : [dokploy.com/blog/v0-29-0-ai-powered-debugging-mcp-server-cli-shared-git-providers](https://dokploy.com/blog/v0-29-0-ai-powered-debugging-mcp-server-cli-shared-git-providers)
- FrankenPHP prod docs : [frankenphp.dev/docs/production](https://frankenphp.dev/docs/production)
- Symfony runtime FrankenPHP : [packagist.org/packages/runtime/frankenphp-symfony](https://packagist.org/packages/runtime/frankenphp-symfony)
- dunglas/symfony-docker : [github.com/dunglas/symfony-docker](https://github.com/dunglas/symfony-docker)
