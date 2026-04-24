// SPDX-License-Identifier: AGPL-3.0-only
import type { RecipeDefinition, RecipeRenderResult, RecipeVars } from "../types";
import { isProductionAppEnv } from "../env";

const DEFAULTS = {
  phpVersion: "8.3",
  nodeVersion: "20",
  rootDir: ".",
  publicDir: "public",
  composerFlags: "--no-dev --no-interaction --optimize-autoloader --no-progress",
  installCommand: "npm ci",
  buildCommand: "npm run build",
  runtimePort: 80,
  appEnv: "prod" as const,
} as const;

function nginxConf(vars: Required<RecipeVars>): string {
  return `worker_processes auto;
daemon off;
error_log /dev/stderr warn;

events { worker_connections 1024; }

http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;
  access_log /dev/stdout;
  sendfile on;
  tcp_nopush on;
  keepalive_timeout 65;
  gzip on;
  gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
  client_max_body_size 20m;

  server {
    listen ${vars.runtimePort} default_server;
    server_name _;
    root /app/${vars.publicDir};
    index index.php;

    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";

    location / {
      try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \\.php$ {
      fastcgi_pass 127.0.0.1:9000;
      fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
      include fastcgi_params;
      fastcgi_buffers 16 32k;
      fastcgi_buffer_size 64k;
      fastcgi_read_timeout 60s;
    }

    location ~ /\\.(?!well-known).* { deny all; }
    location = /favicon.ico { access_log off; log_not_found off; }
    location = /robots.txt  { access_log off; log_not_found off; }

    error_page 404 /index.php;
  }
}
`;
}

function phpFpmConf(): string {
  return `[global]
error_log = /dev/stderr
log_level = notice
daemonize = no

[www]
user = www-data
group = www-data
listen = 127.0.0.1:9000
pm = dynamic
pm.max_children = 20
pm.start_servers = 3
pm.min_spare_servers = 2
pm.max_spare_servers = 6
pm.max_requests = 500
; Forward worker stdout/stderr to container logs, but without the
; "WARNING: [pool www] child N said into stderr" decoration which would
; wrap every Monolog line as a php-fpm warning in dev/debug mode.
catch_workers_output = yes
decorate_workers_output = no
clear_env = no
access.log = /dev/stdout
access.format = "%R - %u %t \\"%m %r\\" %s"
`;
}

function entrypoint(vars: Required<RecipeVars>): string {
  const pub = vars.publicDir;
  return `#!/bin/sh
set -e

APP_DIR=/app

# Storage & bootstrap/cache must be writable by www-data.
mkdir -p "$APP_DIR/storage/logs" \\
         "$APP_DIR/storage/framework/cache" \\
         "$APP_DIR/storage/framework/sessions" \\
         "$APP_DIR/storage/framework/views" \\
         "$APP_DIR/bootstrap/cache"
chown -R www-data:www-data "$APP_DIR/storage" "$APP_DIR/bootstrap/cache"
chmod -R ug+rwX         "$APP_DIR/storage" "$APP_DIR/bootstrap/cache"

# APP_KEY: generate a one-shot key if the user hasn't set one — prod apps MUST
# set APP_KEY via env vars. The fallback prevents a 500 on first boot.
if [ -z "\${APP_KEY:-}" ]; then
  echo "[ploydok] WARNING: APP_KEY not set — generating ephemeral key" >&2
  APP_KEY="base64:$(openssl rand -base64 32)"
  export APP_KEY
fi

# Pre-warm caches. Failures are non-fatal in case a migration hasn't run yet.
php artisan config:cache  || true
php artisan route:cache   || true
php artisan view:cache    || true

if [ "\${PLOYDOK_MIGRATE_ON_BOOT:-1}" = "1" ]; then
  echo "[ploydok] running migrations…" >&2
  php artisan migrate --force || echo "[ploydok] migrate failed (non-fatal at boot)" >&2
fi

# Drop privileges for php-fpm workers via pool config. nginx runs as root to
# bind the privileged port if needed (nginx master forks workers as www-data).
php-fpm -F -y /etc/php-fpm.conf &
exec nginx -c /etc/nginx/nginx.conf
`;
}

function dockerfile(vars: Required<RecipeVars>, rootDirArg: string): string {
  const rootDir = rootDirArg === "." || rootDirArg === "" ? "." : rootDirArg;
  const isProd = isProductionAppEnv(vars.appEnv);
  // Laravel convention: APP_ENV=production | local | staging | …
  // We forward the raw value so `config/` env-dir lookups resolve correctly.
  const runtimeAppEnv = vars.appEnv && vars.appEnv.trim() ? vars.appEnv.trim() : "production";
  const runtimeAppDebug = isProd ? "false" : "true";
  const opcacheValidate = isProd ? "0" : "1";
  // --no-dev may already be present in DEFAULTS composerFlags; composer is
  // tolerant of duplicates, and stripping it only when !isProd keeps dev deps.
  const composerFlags = isProd
    ? vars.composerFlags
    : vars.composerFlags.replace(/--no-dev/g, "").replace(/\s+/g, " ").trim();
  return `# syntax=docker/dockerfile:1.7
# Ploydok recipe php-laravel.v1 — PHP ${vars.phpVersion}, Node ${vars.nodeVersion}, Laravel-aware
# Multi-stage: composer deps → node assets → runtime (nginx + php-fpm)

# ---- Stage 1: composer deps ----
FROM composer:2 AS vendor
WORKDIR /src
COPY ${rootDir}/composer.json ${rootDir}/composer.lock* ./
RUN composer install ${composerFlags} --no-scripts --prefer-dist \\
    --ignore-platform-reqs

# ---- Stage 2: front-end assets (Vite) ----
FROM node:${vars.nodeVersion}-alpine AS assets
WORKDIR /src
COPY ${rootDir}/package.json ${rootDir}/package-lock.json* ${rootDir}/yarn.lock* ${rootDir}/pnpm-lock.yaml* ./
# Tolerate repos without a front-end lockfile.
RUN (test -f package-lock.json && ${vars.installCommand}) \\
 || (test -f yarn.lock && yarn install --frozen-lockfile) \\
 || (test -f pnpm-lock.yaml && corepack pnpm install --frozen-lockfile) \\
 || npm install
COPY ${rootDir} .
COPY --from=vendor /src/vendor ./vendor
RUN ${vars.buildCommand} || echo "no build step"

# ---- Stage 3: runtime ----
FROM php:${vars.phpVersion}-fpm-alpine AS runtime

RUN apk add --no-cache nginx git unzip icu-libs oniguruma libpng libzip libpq openssl ca-certificates tzdata curl bash \\
 && apk add --no-cache --virtual .build-deps $PHPIZE_DEPS icu-dev oniguruma-dev libpng-dev libzip-dev postgresql-dev libxml2-dev \\
 && docker-php-ext-install -j$(nproc) pdo pdo_mysql pdo_pgsql mbstring gd bcmath intl zip opcache \\
 && apk del .build-deps \\
 && rm -rf /var/cache/apk/* /tmp/*

# Sensible php.ini overrides for prod.
RUN { \\
  echo 'expose_php=Off'; \\
  echo 'memory_limit=256M'; \\
  echo 'post_max_size=20M'; \\
  echo 'upload_max_filesize=20M'; \\
  echo 'opcache.enable=1'; \\
  echo 'opcache.validate_timestamps=${opcacheValidate}'; \\
  echo 'opcache.max_accelerated_files=20000'; \\
  echo 'opcache.memory_consumption=192'; \\
  echo 'realpath_cache_size=4096K'; \\
  echo 'realpath_cache_ttl=600'; \\
 } > /usr/local/etc/php/conf.d/99-ploydok.ini

WORKDIR /app
COPY ${rootDir} /app
COPY --from=vendor /src/vendor /app/vendor
COPY --from=assets /src/${vars.publicDir}/build /app/${vars.publicDir}/build

# Tooling configs
COPY ploydok/nginx.conf   /etc/nginx/nginx.conf
COPY ploydok/php-fpm.conf /etc/php-fpm.conf
COPY ploydok/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \\
 && mkdir -p /run/nginx \\
 && chown -R www-data:www-data /app

EXPOSE ${vars.runtimePort}
ENV APP_ENV=${runtimeAppEnv} \\
    APP_DEBUG=${runtimeAppDebug} \\
    LOG_CHANNEL=stderr \\
    LOG_LEVEL=${isProd ? "warning" : "debug"}
ENTRYPOINT ["/entrypoint.sh"]
`;
}

function renderFn(vars: Required<RecipeVars>): RecipeRenderResult {
  return {
    files: {
      Dockerfile: dockerfile(vars, vars.rootDir),
      "ploydok/nginx.conf": nginxConf(vars),
      "ploydok/php-fpm.conf": phpFpmConf(),
      "ploydok/entrypoint.sh": entrypoint(vars),
    },
    dockerfilePath: "Dockerfile",
    runtimePort: vars.runtimePort,
    warnings:
      vars.phpVersion !== "8.3"
        ? [`Recipe testée avec PHP 8.3, tu as configuré ${vars.phpVersion} — build peut casser.`]
        : [],
  };
}

export const phpLaravelV1: RecipeDefinition = {
  id: "php-laravel.v1",
  version: "1.0.0",
  label: "PHP Laravel (php-fpm + nginx)",
  description:
    "Multi-stage: composer → Vite → php-fpm 8.3 + nginx Alpine. Migrations auto, opcache tuné, logs stderr/stdout.",
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
    };
    return renderFn(merged);
  },
};
