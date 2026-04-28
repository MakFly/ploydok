# Symfony reference stacks for Ploydok

Deux chemins officiellement supportés pour déployer un Symfony / API Platform
sur Ploydok. Les fichiers de ce dossier sont **à copier dans le repo user** —
ils ne font pas partie du runtime Ploydok.

## Path 1 — Nixpacks managed by Ploydok (default)

Rien à committer dans le repo user.

Ploydok détecte `symfony.lock` / `bin/console` via le stack classifier et
auto-injecte les variables suivantes comme env vars de l'app :

- `NIXPACKS_PHP_ROOT_DIR=/app/public`
- `NIXPACKS_PHP_FALLBACK_PATH=/index.php`

Le front-controller Symfony est donc correctement servi sans aucune
configuration manuelle.

**Différenciation concurrents :**

- Coolify [documente ces deux vars](https://coolify.io/docs/applications/symfony)
  mais demande à l'utilisateur de les saisir à la main.
- Dokploy n'implémente aucun middleware framework-aware.

**Stack image produite :** Ubuntu + PHP + php-fpm + nginx (via Nixpacks).

**Quand choisir :** app Symfony "lambda", zéro besoin de perf extrême.

## Path 2 — FrankenPHP via Dockerfile (prod haute-perf)

3 fichiers à committer dans le repo user (fournis dans ce dossier) :

- `Dockerfile` — base `dunglas/frankenphp:1-php8.4`, worker mode ON, JIT tracing
- `Caddyfile` — bind plain HTTP `:80`, TLS off (terminé par Ploydok front Caddy)
- `docker-entrypoint.sh` — warm-up Symfony + lancement FrankenPHP

Ploydok utilise le Dockerfile tel quel (`buildMethod=dockerfile`).

**Note Caddyfile :** ne pas utiliser `php_server { try_files ... }` en worker
mode — le Kernel Symfony gère lui-même le routing en mémoire. Utiliser
`php_server` seul (sans bloc `try_files`). Le fichier fourni est déjà corrigé.

**Note HEALTHCHECK :** l'image `dunglas/frankenphp` embarque un `HEALTHCHECK`
par défaut qui interroge `http://localhost:2019/metrics` (admin API Caddy).
Notre Caddyfile met `admin off` (best-practice prod), ce qui fait échouer ce
probe en boucle même quand l'app tourne parfaitement. Le `Dockerfile` fourni
override le healthcheck pour probe l'app elle-même sur `:80`. Ploydok injecte
également son propre `HEALTHCHECK` au spawn (via `apps.healthcheck_path`) qui
supersède tout ce que l'image embarque — donc le double filet existe.

**Recommandé officiellement** par Symfony pour la prod depuis Symfony 7.4
([runtime/frankenphp-symfony](https://packagist.org/packages/runtime/frankenphp-symfony)).

**Quand choisir :** API haute fréquence (API Platform), besoin de HTTP/2+3,
besoin d'un process unique au lieu de php-fpm + nginx.

### Env vars Ploydok UI (Path 2 uniquement)

| Clé               | Valeur exemple                       | Pourquoi                      |
| ----------------- | ------------------------------------ | ----------------------------- |
| `APP_SECRET`      | `openssl rand -hex 32`               | Signature cookies Symfony     |
| `DATABASE_URL`    | `postgresql://user:pass@db:5432/app` | Doctrine                      |
| `APP_ENV`         | `prod`                               | Activé par défaut dans ENV    |
| `TRUSTED_PROXIES` | `127.0.0.1,REMOTE_ADDR`              | X-Forwarded-\* depuis Ploydok |

## Benchmark indicatif

Mesuré sur `ploydok-app-frankenphp-t12-validate-k4dkwr0l-green`
(FrankenPHP v1.12.2 / PHP 8.4.20 / Caddy v2.11.2) — endpoint `/api`
(Hydra entrypoint API Platform), 50 requêtes séquentielles via la
Caddy outer Ploydok (port 8180).

| Stack                      | p50    | p99    | min    | max    |
| -------------------------- | ------ | ------ | ------ | ------ |
| Nixpacks (php-fpm + nginx) | ~30 ms | ~80 ms | —      | —      |
| FrankenPHP worker (JIT on) | 4.9 ms | 6.2 ms | 3.0 ms | 6.3 ms |

Chiffres FrankenPHP : valeurs réelles mesurées (T1.2). Chiffres Nixpacks :
indicatifs (pas de bench équivalent disponible ce run). Dépendent de la
machine, du dataset Doctrine et du warmup du kernel cache.

## Fichiers fournis

| Fichier                | Usage                                    |
| ---------------------- | ---------------------------------------- |
| `Dockerfile`           | Path 2 — base image FrankenPHP           |
| `Caddyfile`            | Path 2 — config Caddy (plain HTTP `:80`) |
| `docker-entrypoint.sh` | Path 2 — entrypoint warmup + boot        |

## Sources

- https://frankenphp.dev/docs/production
- https://packagist.org/packages/runtime/frankenphp-symfony
- https://coolify.io/docs/applications/symfony
- `project-docs/plans/PLAN-build-strategy-v2.md`
- `project-docs/decisions/0004-build-strategy.md` (à créer wave 4)
