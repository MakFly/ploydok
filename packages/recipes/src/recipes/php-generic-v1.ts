// SPDX-License-Identifier: AGPL-3.0-only
import type { RecipeDefinition, RecipeRenderResult, RecipeVars } from "../types";

const DEFAULTS = {
  phpVersion: "8.3",
  nodeVersion: "20",
  rootDir: ".",
  publicDir: "public",
  composerFlags: "--no-dev --no-interaction --optimize-autoloader --no-progress",
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
  gzip on;

  server {
    listen ${vars.runtimePort} default_server;
    server_name _;
    root /app/${vars.publicDir};
    index index.php index.html;

    location / {
      try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \\.php$ {
      fastcgi_pass 127.0.0.1:9000;
      fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
      include fastcgi_params;
    }

    location ~ /\\.(?!well-known).* { deny all; }
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
pm.max_children = 10
pm.start_servers = 2
pm.min_spare_servers = 1
pm.max_spare_servers = 4
pm.max_requests = 500
catch_workers_output = yes
decorate_workers_output = no
clear_env = no
access.log = /dev/stdout
`;
}

function entrypoint(): string {
  return `#!/bin/sh
set -e
mkdir -p /run/nginx
php-fpm -F -y /etc/php-fpm.conf &
exec nginx -c /etc/nginx/nginx.conf
`;
}

function dockerfile(vars: Required<RecipeVars>): string {
  const rootDir = vars.rootDir === "." || vars.rootDir === "" ? "." : vars.rootDir;
  return `# syntax=docker/dockerfile:1.7
# Ploydok recipe php-generic.v1 — PHP ${vars.phpVersion} + nginx, no framework assumption.

FROM composer:2 AS vendor
WORKDIR /src
COPY ${rootDir}/composer.json ${rootDir}/composer.lock* ./
RUN composer install ${vars.composerFlags} --no-scripts --prefer-dist --ignore-platform-reqs

FROM php:${vars.phpVersion}-fpm-alpine AS runtime
RUN apk add --no-cache nginx git unzip icu-libs oniguruma libpng libzip libpq openssl ca-certificates curl \\
 && apk add --no-cache --virtual .build-deps $PHPIZE_DEPS icu-dev oniguruma-dev libpng-dev libzip-dev postgresql-dev libxml2-dev \\
 && docker-php-ext-install -j$(nproc) pdo pdo_mysql pdo_pgsql mbstring intl zip opcache \\
 && apk del .build-deps \\
 && rm -rf /var/cache/apk/* /tmp/*

RUN { \\
  echo 'expose_php=Off'; \\
  echo 'memory_limit=256M'; \\
  echo 'opcache.enable=1'; \\
  echo 'opcache.validate_timestamps=1'; \\
 } > /usr/local/etc/php/conf.d/99-ploydok.ini

WORKDIR /app
COPY ${rootDir} /app
COPY --from=vendor /src/vendor /app/vendor

COPY ploydok/nginx.conf   /etc/nginx/nginx.conf
COPY ploydok/php-fpm.conf /etc/php-fpm.conf
COPY ploydok/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \\
 && mkdir -p /run/nginx \\
 && chown -R www-data:www-data /app

EXPOSE ${vars.runtimePort}
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

export const phpGenericV1: RecipeDefinition = {
  id: "php-generic.v1",
  version: "1.0.0",
  label: "PHP generic (php-fpm + nginx)",
  description: "Base PHP 8.3 + nginx, composer install, public/ docroot configurable. Pas d'hypothèse framework.",
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
