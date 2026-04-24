// SPDX-License-Identifier: AGPL-3.0-only
import type { RecipeDefinition, RecipeRenderResult, RecipeVars } from "../types";
import { isProductionAppEnv } from "../env";

const DEFAULTS = {
  phpVersion: "8.4",
  nodeVersion: "20",
  rootDir: ".",
  publicDir: "public",
  // Vendor stage runs without autoloader/scripts (src/ isn't copied yet).
  // Autoloader is regenerated in the runtime stage once src/ is present.
  // `--no-dev` is dropped when appEnv=dev (see dockerfile() below) so that
  // web-profiler-bundle, maker-bundle, etc. are available.
  composerFlags: "--no-interaction --no-progress --no-scripts --no-autoloader",
  installCommand: "",
  buildCommand: "",
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

    # Symfony front-controller pattern.
    location / {
      try_files $uri /index.php$is_args$args;
    }

    location ~ ^/index\\.php(/|$) {
      fastcgi_pass 127.0.0.1:9000;
      fastcgi_split_path_info ^(.+\\.php)(/.*)$;
      include fastcgi_params;
      fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
      fastcgi_param DOCUMENT_ROOT $realpath_root;
      internal;
    }

    # Block all other PHP URIs — only index.php should be executed.
    location ~ \\.php$ { return 404; }

    location ~ /\\.(?!well-known).* { deny all; }
    location = /favicon.ico { access_log off; log_not_found off; }
    location = /robots.txt  { access_log off; log_not_found off; }
  }
}
`;
}

function phpFpmConf(): string {
  return `[global]
error_log = /dev/stderr
; Keep php-fpm master chatty only about actual problems — worker stderr is
; already forwarded below without the noisy "WARNING: child N said into stderr"
; decoration (see decorate_workers_output).
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
; Forward worker stdout/stderr to container logs so user app logs are visible.
catch_workers_output = yes
; But drop the "WARNING: [pool www] child N said into stderr: \\"NOTICE: PHP message: ...\\""
; wrapper — in dev mode Symfony emits a debug line per event listener, and
; wrapping each one as a php-fpm WARNING floods docker logs with noise.
decorate_workers_output = no
clear_env = no
access.log = /dev/stdout
`;
}

function entrypoint(): string {
  return `#!/bin/sh
set -e

APP_DIR=/app
mkdir -p "$APP_DIR/var/cache" "$APP_DIR/var/log"
chown -R www-data:www-data "$APP_DIR/var"
chmod -R ug+rwX         "$APP_DIR/var"

# APP_SECRET fallback (prod apps MUST provide their own).
if [ -z "\${APP_SECRET:-}" ]; then
  echo "[ploydok] WARNING: APP_SECRET not set — generating ephemeral secret" >&2
  APP_SECRET="$(openssl rand -hex 16)"
  export APP_SECRET
fi

# Warmup Symfony cache as www-data.
if [ -f bin/console ]; then
  su-exec www-data php bin/console cache:warmup --no-interaction || true
fi

if [ "\${PLOYDOK_MIGRATE_ON_BOOT:-1}" = "1" ] && [ -f bin/console ]; then
  echo "[ploydok] running doctrine migrations…" >&2
  php bin/console doctrine:migrations:migrate --no-interaction --allow-no-migration || \\
    echo "[ploydok] migrate failed (non-fatal at boot)" >&2
fi

php-fpm -F -y /etc/php-fpm.conf &
exec nginx -c /etc/nginx/nginx.conf
`;
}

function dockerfile(vars: Required<RecipeVars>): string {
  const rootDir = vars.rootDir === "." || vars.rootDir === "" ? "." : vars.rootDir;
  const hasNodeStage = vars.installCommand !== "" || vars.buildCommand !== "";
  // Any non-production env name (dev, staging, preprod, preview, test, …)
  // drops --no-dev + enables APP_DEBUG so the profiler + dev tools load.
  const isProd = isProductionAppEnv(vars.appEnv);
  const composerNoDev = isProd ? " --no-dev" : "";
  const opcacheValidate = isProd ? "0" : "1";
  // Forward the user's raw value to the container so Symfony picks the right
  // env dir (config/packages/$APP_ENV/…). Fallback to "prod" if unspecified.
  const runtimeAppEnv = vars.appEnv && vars.appEnv.trim() ? vars.appEnv.trim() : "prod";
  const runtimeAppDebug = isProd ? "0" : "1";
  return `# syntax=docker/dockerfile:1.7
# Ploydok recipe php-symfony.v1 — PHP ${vars.phpVersion}, API Platform / Symfony-aware
#
# Multi-stage strategy:
#   1. vendor   — install composer deps WITHOUT autoloader (src/ isn't here yet).
#   2. assets?  — optional Node build stage for Encore/Vite assets.
#   3. runtime  — copy src + vendor, regenerate classmap-authoritative autoloader.
# Regenerating at runtime stage guarantees App\\Kernel (and other PSR-4 classes
# under src/) are present in the classmap — required for Symfony's front
# controller to boot under opcache preloading.

# ---- Stage 1: composer deps (no autoloader) ----
FROM composer:2 AS vendor
WORKDIR /src
COPY ${rootDir}/composer.json ${rootDir}/composer.lock* ${rootDir}/symfony.lock* ./
RUN composer install ${vars.composerFlags}${composerNoDev} --prefer-dist --ignore-platform-reqs

${hasNodeStage ? `# ---- Stage 2: front-end (optional) ----
FROM node:${vars.nodeVersion}-alpine AS assets
WORKDIR /src
COPY ${rootDir} .
COPY --from=vendor /src/vendor ./vendor
RUN ${vars.installCommand || "true"} && ${vars.buildCommand || "true"}
` : ""}
# ---- Stage 3: runtime ----
FROM php:${vars.phpVersion}-fpm-alpine AS runtime

RUN apk add --no-cache nginx git unzip icu-libs oniguruma libpng libzip libpq openssl ca-certificates tzdata curl bash su-exec \\
 && apk add --no-cache --virtual .build-deps $PHPIZE_DEPS icu-dev oniguruma-dev libpng-dev libzip-dev postgresql-dev libxml2-dev \\
 && docker-php-ext-install -j$(nproc) pdo pdo_mysql pdo_pgsql mbstring intl zip opcache \\
 && apk del .build-deps \\
 && rm -rf /var/cache/apk/* /tmp/*

# Bring composer into the runtime stage just long enough to regenerate the
# optimized autoloader with the full source. Removed before the final layer.
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
# Regenerate autoloader with full src/ visible → App\\Kernel in the classmap.
RUN composer dump-autoload${composerNoDev} --optimize --classmap-authoritative --no-scripts \\
 && rm -f /usr/local/bin/composer

COPY ploydok/nginx.conf   /etc/nginx/nginx.conf
COPY ploydok/php-fpm.conf /etc/php-fpm.conf
COPY ploydok/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \\
 && mkdir -p /run/nginx \\
 && chown -R www-data:www-data /app

EXPOSE ${vars.runtimePort}
ENV APP_ENV=${runtimeAppEnv} \\
    APP_DEBUG=${runtimeAppDebug}
ENTRYPOINT ["/entrypoint.sh"]
`;
}

function renderFn(vars: Required<RecipeVars>): RecipeRenderResult {
  return {
    files: {
      Dockerfile: dockerfile(vars),
      "ploydok/nginx.conf": nginxConf(vars),
      "ploydok/php-fpm.conf": phpFpmConf(),
      "ploydok/entrypoint.sh": entrypoint(),
    },
    dockerfilePath: "Dockerfile",
    runtimePort: vars.runtimePort,
    warnings: [],
  };
}

export const phpSymfonyV1: RecipeDefinition = {
  id: "php-symfony.v1",
  version: "1.0.0",
  label: "PHP Symfony (php-fpm + nginx)",
  description:
    "Multi-stage Symfony / API Platform: composer optim → php-fpm 8.4 + nginx Alpine. Doctrine migrations auto, opcache agressif, front-controller strict.",
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
