# syntax=docker/dockerfile:1.7
#
# Production-grade FrankenPHP Dockerfile for a Symfony / API Platform app.
# Drop this file + Caddyfile + docker-entrypoint.sh at the repo root,
# switch Ploydok's buildMethod to "dockerfile".
#
# Why FrankenPHP over php-fpm + nginx:
#   - single Go process (Caddy inside) — no supervisor, no orchestration of
#     two daemons, no "child said into stderr" noise in docker logs
#   - worker mode keeps App\Kernel in memory between requests — 2-4× the
#     throughput on API Platform vs a cold front controller
#   - HTTP/2 + HTTP/3 + early hints + Mercure out of the box
#   - every common PHP extension is precompiled into dunglas/frankenphp
#     (mbstring, pdo_pgsql, pdo_mysql, intl, zip, opcache, …)

ARG PHP_VERSION=8.4
ARG FRANKENPHP_VERSION=1

# ---- Stage 1: composer deps (no autoloader) --------------------------------
FROM composer:2 AS vendor
WORKDIR /src

# Copy only the lock-relevant files so the layer is cached across source edits.
COPY composer.json composer.lock* symfony.lock* ./
RUN composer install \
      --no-interaction --no-progress \
      --no-scripts --no-autoloader \
      --no-dev \
      --prefer-dist --ignore-platform-reqs

# ---- Stage 2: runtime ------------------------------------------------------
FROM dunglas/frankenphp:${FRANKENPHP_VERSION}-php${PHP_VERSION} AS runtime

# Official FrankenPHP image is Debian slim and ships php-opcache + intl +
# mbstring + pdo_pgsql + pdo_mysql + zip + gd already compiled. We only need
# openssl (APP_SECRET fallback) + tzdata + ca-certificates for outgoing TLS.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      openssl ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*

# Pull composer into the runtime stage *temporarily* to regenerate the
# classmap-authoritative autoloader once src/ is present. Worker mode loads
# App\Kernel once — it MUST be in the classmap, not resolved lazily.
COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer

# Production PHP settings: freeze opcache, raise JIT memory, silence expose_php.
RUN { \
      echo 'expose_php=Off'; \
      echo 'memory_limit=256M'; \
      echo 'date.timezone=UTC'; \
      echo 'realpath_cache_size=4096K'; \
      echo 'realpath_cache_ttl=600'; \
      echo 'opcache.enable=1'; \
      echo 'opcache.enable_cli=1'; \
      echo 'opcache.validate_timestamps=0'; \
      echo 'opcache.max_accelerated_files=20000'; \
      echo 'opcache.memory_consumption=192'; \
      echo 'opcache.jit=tracing'; \
      echo 'opcache.jit_buffer_size=64M'; \
    } > /usr/local/etc/php/conf.d/99-prod.ini

WORKDIR /app

# Copy source + vendor, then lock the optimized autoloader.
COPY . /app
COPY --from=vendor /src/vendor /app/vendor
RUN composer dump-autoload \
      --optimize --classmap-authoritative \
      --no-dev --no-scripts \
 && rm -f /usr/local/bin/composer \
 && chown -R www-data:www-data /app

COPY Caddyfile             /etc/frankenphp/Caddyfile
COPY docker-entrypoint.sh  /usr/local/bin/docker-entrypoint
RUN chmod +x /usr/local/bin/docker-entrypoint

EXPOSE 80
# TLS is terminated by Ploydok's outer Caddy, so the internal server listens
# plain HTTP on :80. SERVER_NAME=":80" tells FrankenPHP to skip its auto-TLS.
ENV APP_ENV=prod \
    APP_DEBUG=0 \
    SERVER_NAME=":80" \
    FRANKENPHP_CONFIG="worker ./public/index.php"

ENTRYPOINT ["docker-entrypoint"]
CMD ["frankenphp", "run", "--config", "/etc/frankenphp/Caddyfile"]
