# Postgres + Redis — local dev setup

## Premier démarrage

```bash
# 1. Générer les mots de passe (idempotent — skippé si déjà présents)
make secrets-init

# 2. Démarrer toute l'infra (postgres + redis + caddy + buildkitd + registry)
make infra-up

# 3. Appliquer les migrations Drizzle sur Postgres
make db-migrate
```

Les mots de passe sont écrits dans `apps/api/.env.local` (gitignored).

## Connexion manuelle

### psql

```bash
# Lire le mot de passe depuis .env.local
PG_PASS=$(grep PLOYDOK_PG_PASSWORD apps/api/.env.local | cut -d= -f2)
psql "postgres://ploydok:${PG_PASS}@127.0.0.1:5434/ploydok"
```

### redis-cli

```bash
REDIS_PASS=$(grep PLOYDOK_REDIS_PASSWORD apps/api/.env.local | cut -d= -f2)
redis-cli -h 127.0.0.1 -p 6380 -a "${REDIS_PASS}" ping
# Expected: PONG
```

## Vérifier l'état des services

```bash
docker ps --filter label=ploydok.kind=infra
# Ou via compose :
docker compose -f infra/docker-compose.yml ps
```

Les deux services doivent afficher `(healthy)` dans la colonne STATUS.

## Reset complet (efface toutes les données)

```bash
make infra-down
docker volume rm ploydok_postgres-data ploydok_redis-data
make infra-up
make db-migrate
```

> Attention : cela supprime toutes les données Postgres et Redis locales.

## Variables d'environnement concernées

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | URL complète Postgres (`postgres://ploydok:<pw>@127.0.0.1:5434/ploydok`) |
| `PLOYDOK_PG_PASSWORD` | Mot de passe Postgres (utilisé par `make infra-up` via Docker Compose) |
| `REDIS_URL` | URL complète Redis (`redis://:<pw>@127.0.0.1:6381/0`) |
| `PLOYDOK_REDIS_PASSWORD` | Mot de passe Redis (utilisé par `redis-server --requirepass`) |

Toutes ces variables sont lues par `apps/api/src/env.ts` et injectées via `apps/api/.env.local`.

## Troubleshooting

**Postgres ne démarre pas** :
```bash
docker compose -f infra/docker-compose.yml logs postgres
```
Cause fréquente : `PLOYDOK_PG_PASSWORD` absent ou vide dans `.env.local`. Relancer `make secrets-init`.

**Redis ne démarre pas** :
```bash
docker compose -f infra/docker-compose.yml logs redis
```
Même cause : `PLOYDOK_REDIS_PASSWORD` absent.

**Ports utilisés** : Postgres sur `5434` (host) → `5432` (container), Redis sur `6381` (host) → `6379` (container). Décalage volontaire pour ne pas entrer en conflit avec des instances locales (ex: autre Dokploy/Coolify sur 5432/6379).

**Port 5433 ou 6380 déjà occupé** :
Modifiez `DATABASE_URL` / `REDIS_URL` dans `.env.local` et les mappings `ports:` dans `infra/docker-compose.yml`.

**Migrations échouent** :
Vérifiez que `DATABASE_URL` dans `.env.local` contient le bon mot de passe (identique à `PLOYDOK_PG_PASSWORD`).
