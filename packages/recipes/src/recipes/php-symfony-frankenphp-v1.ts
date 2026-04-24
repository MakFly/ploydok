// SPDX-License-Identifier: AGPL-3.0-only
import type { RecipeDefinition, RecipeRenderResult, RecipeVars } from "../types"
import { isProductionAppEnv } from "../env"

const DEFAULTS = {
  phpVersion: "8.4",
  nodeVersion: "20",
  rootDir: ".",
  publicDir: "public",
  composerFlags: "--no-interaction --no-progress --no-scripts --no-autoloader",
  installCommand: "",
  buildCommand: "",
  runtimePort: 80,
  appEnv: "prod" as const,
} as const

function caddyfile(vars: Required<RecipeVars>): string {
  // FrankenPHP sits behind Ploydok's outer Caddy, so TLS/HTTP3 are handled
  // upstream. This inner Caddyfile only wires the front-controller.
  return `{
\tfrankenphp
\tauto_https off
\tadmin off
\tlog {
\t\toutput stdout
\t\tformat json
\t}
\tservers {
\t\ttrusted_proxies static private_ranges
\t}
}

:${vars.runtimePort} {
\troot * /app/${vars.publicDir}
\tencode zstd br gzip
\tphp_server {
\t\ttry_files {path} /index.php?{query}
\t}
\theader {
\t\tX-Frame-Options "SAMEORIGIN"
\t\tX-Content-Type-Options "nosniff"
\t\t-Server
\t}
}
`
}

function entrypoint(isProd: boolean): string {
  const workerLine = isProd
    ? 'export FRANKENPHP_CONFIG="${FRANKENPHP_CONFIG:-worker /app/public/index.php}"'
    : '# Worker mode OFF in non-prod: code changes must be picked up without a restart.\nexport FRANKENPHP_CONFIG="${FRANKENPHP_CONFIG:-}"'
  return `#!/bin/sh
set -e

APP_DIR=/app
mkdir -p "$APP_DIR/var/cache" "$APP_DIR/var/log"
# FrankenPHP's default image runs as root but drops to www-data for PHP workers.
chown -R www-data:www-data "$APP_DIR/var" 2>/dev/null || true
chmod -R ug+rwX           "$APP_DIR/var" 2>/dev/null || true

if [ -z "\${APP_SECRET:-}" ]; then
  echo "[ploydok] WARNING: APP_SECRET not set — generating ephemeral secret" >&2
  APP_SECRET="$(openssl rand -hex 16)"
  export APP_SECRET
fi

if [ -f bin/console ]; then
  php bin/console cache:warmup --no-interaction || true
fi

if [ "\${PLOYDOK_MIGRATE_ON_BOOT:-1}" = "1" ] && [ -f bin/console ]; then
  echo "[ploydok] running doctrine migrations…" >&2
  php bin/console doctrine:migrations:migrate --no-interaction --allow-no-migration || \\
    echo "[ploydok] migrate failed (non-fatal at boot)" >&2
fi

${workerLine}

exec frankenphp run --config /etc/frankenphp/Caddyfile
`
}

function dockerfile(vars: Required<RecipeVars>): string {
  const rootDir =
    vars.rootDir === "." || vars.rootDir === "" ? "." : vars.rootDir
  const hasNodeStage = vars.installCommand !== "" || vars.buildCommand !== ""
  const isProd = isProductionAppEnv(vars.appEnv)
  const composerNoDev = isProd ? " --no-dev" : ""
  const opcacheValidate = isProd ? "0" : "1"
  const runtimeAppEnv =
    vars.appEnv && vars.appEnv.trim() ? vars.appEnv.trim() : "prod"
  const runtimeAppDebug = isProd ? "0" : "1"
  return `# syntax=docker/dockerfile:1.7
# Ploydok recipe php-symfony-frankenphp.v1 — FrankenPHP ${vars.phpVersion}
#
# FrankenPHP = single-process PHP runtime built on Caddy (Go). Ships with
# every common PHP extension precompiled, HTTP/2+3, early hints, and an
# optional worker mode that keeps the Symfony kernel in memory between
# requests — typically 2–4× the throughput of php-fpm + nginx on API Platform.

# ---- Stage 1: composer deps (no autoloader) ----
FROM composer:2 AS vendor
WORKDIR /src
COPY ${rootDir}/composer.json ${rootDir}/composer.lock* ${rootDir}/symfony.lock* ./
RUN composer install ${vars.composerFlags}${composerNoDev} --prefer-dist --ignore-platform-reqs

${
  hasNodeStage
    ? `# ---- Stage 2: front-end (optional) ----
FROM node:${vars.nodeVersion}-alpine AS assets
WORKDIR /src
COPY ${rootDir} .
COPY --from=vendor /src/vendor ./vendor
RUN ${vars.installCommand || "true"} && ${vars.buildCommand || "true"}
`
    : ""
}
# ---- Stage 3: runtime (FrankenPHP) ----
FROM dunglas/frankenphp:1-php${vars.phpVersion} AS runtime

# FrankenPHP images are Debian-based and ship php, opcache, intl, mbstring,
# pdo_pgsql, pdo_mysql, zip, gd, etc. out of the box. We only need composer
# for the classmap regen, and a tiny toolbox for the entrypoint.
RUN apt-get update \\
 && apt-get install -y --no-install-recommends openssl ca-certificates tzdata curl \\
 && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer

RUN { \\
  echo 'expose_php=Off'; \\
  echo 'memory_limit=256M'; \\
  echo 'opcache.enable=1'; \\
  echo 'opcache.validate_timestamps=${opcacheValidate}'; \\
  echo 'opcache.max_accelerated_files=20000'; \\
  echo 'opcache.memory_consumption=192'; \\
  echo 'realpath_cache_size=4096K'; \\
  echo 'realpath_cache_ttl=600'; \\
  echo 'date.timezone=UTC'; \\
 } > /usr/local/etc/php/conf.d/99-ploydok.ini

WORKDIR /app
COPY ${rootDir} /app
COPY --from=vendor /src/vendor /app/vendor
${hasNodeStage ? `COPY --from=assets /src/${vars.publicDir}/build /app/${vars.publicDir}/build\n` : ""}
# Regenerate autoloader now that src/ is visible — FrankenPHP's worker mode
# loads App\\Kernel once and reuses it, so it MUST be in the classmap.
RUN composer dump-autoload${composerNoDev} --optimize --classmap-authoritative --no-scripts \\
 && rm -f /usr/local/bin/composer

COPY ploydok/Caddyfile /etc/frankenphp/Caddyfile
COPY ploydok/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \\
 && chown -R www-data:www-data /app

EXPOSE ${vars.runtimePort}
ENV APP_ENV=${runtimeAppEnv} \\
    APP_DEBUG=${runtimeAppDebug} \\
    SERVER_NAME=":${vars.runtimePort}"
ENTRYPOINT ["/entrypoint.sh"]
`
}

function renderFn(vars: Required<RecipeVars>): RecipeRenderResult {
  const isProd = isProductionAppEnv(vars.appEnv)
  return {
    files: {
      Dockerfile: dockerfile(vars),
      "ploydok/Caddyfile": caddyfile(vars),
      "ploydok/entrypoint.sh": entrypoint(isProd),
    },
    dockerfilePath: "Dockerfile",
    runtimePort: vars.runtimePort,
    warnings: isProd
      ? []
      : [
          "FrankenPHP worker mode désactivé (appEnv non-prod) — les changements de code sont visibles sans restart.",
        ],
  }
}

export const phpSymfonyFrankenphpV1: RecipeDefinition = {
  id: "php-symfony-frankenphp.v1",
  version: "1.0.0",
  label: "PHP Symfony (FrankenPHP, worker mode)",
  description:
    "FrankenPHP 1 + PHP 8.4 : serveur natif Go basé sur Caddy, worker mode Symfony en prod (Kernel en mémoire, 2–4× php-fpm sur API Platform), HTTP/2+3 natif. Doctrine migrations auto.",
  defaults: DEFAULTS,
  render(vars: RecipeVars): RecipeRenderResult {
    const merged: Required<RecipeVars> = {
      phpVersion: vars.phpVersion ?? DEFAULTS.phpVersion,
      nodeVersion: vars.nodeVersion ?? DEFAULTS.nodeVersion,
      rootDir: vars.rootDir ?? DEFAULTS.rootDir,
      publicDir: vars.publicDir ?? DEFAULTS.publicDir,
      composerFlags: vars.composerFlags ?? DEFAULTS.composerFlags,
      installCommand: vars.installCommand ?? DEFAULTS.installCommand,
      buildCommand: vars.buildCommand ?? DEFAULTS.buildCommand,
      runtimePort: vars.runtimePort ?? DEFAULTS.runtimePort,
      appEnv: vars.appEnv ?? DEFAULTS.appEnv,
    }
    return renderFn(merged)
  },
}
