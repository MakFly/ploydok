#!/bin/sh
set -e

# Symfony writes cache + logs under var/. Make sure FrankenPHP's worker (which
# runs as www-data) can write there before the Kernel boots, otherwise every
# request 500s with a "Permission denied" on cache/prod/.
mkdir -p /app/var/cache /app/var/log
chown -R www-data:www-data /app/var
chmod -R ug+rwX /app/var

# Production apps MUST provide their own APP_SECRET through Ploydok's env UI;
# this fallback only exists so the container doesn't crash on first boot if
# the operator forgot to set one. Ephemeral value = sessions die on restart.
if [ -z "${APP_SECRET:-}" ]; then
	echo "[ploydok] WARNING: APP_SECRET not set — generating ephemeral secret" >&2
	APP_SECRET="$(openssl rand -hex 16)"
	export APP_SECRET
fi

# Warmup compiled container BEFORE the worker starts — otherwise the first
# request takes the hit of compiling config/services/*.yaml into the cache.
if [ -f bin/console ]; then
	php bin/console cache:warmup --no-interaction --env="${APP_ENV:-prod}" || true
fi

# Doctrine migrations — idempotent, --allow-no-migration means an app with
# zero migrations won't crash the boot.
if [ "${PLOYDOK_MIGRATE_ON_BOOT:-1}" = "1" ] && [ -f bin/console ]; then
	echo "[ploydok] running doctrine migrations…" >&2
	php bin/console doctrine:migrations:migrate \
		--no-interaction --allow-no-migration \
		|| echo "[ploydok] migrate failed (non-fatal at boot)" >&2
fi

exec "$@"
