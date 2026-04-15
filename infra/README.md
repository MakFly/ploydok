# Infra — Caddy + ploydok services

## Démarrage rapide

```bash
# Depuis la racine du repo
docker compose -f infra/docker-compose.yml up -d caddy
```

Caddy démarre sur les ports 80/443 et expose son admin API sur `127.0.0.1:2019`.

## Vérifier l'admin API

```bash
curl -sf http://127.0.0.1:2019/config/
```

Une réponse `null` (config vide) ou un objet JSON indique que Caddy fonctionne.

## Variables d'environnement

Copier `.env.example` → `.env` dans ce répertoire :

```bash
cp infra/.env.example infra/.env
```

| Variable         | Défaut      | Description                              |
|------------------|-------------|------------------------------------------|
| `PLOYDOK_DOMAIN` | `localhost` | Domaine racine pour les apps managées    |

## Arrêt

```bash
docker compose -f infra/docker-compose.yml down
```

## Sécurité — Admin API

**L'admin API Caddy ne doit JAMAIS être exposée publiquement.**

Le mapping de port `127.0.0.1:2019:2019` garantit que seul le processus local (apps/api) peut
joindre l'API. Ne jamais modifier ce binding en `0.0.0.0:2019:2019`.

## Configuration Caddy

Le `Caddyfile` dans `infra/caddy/Caddyfile` sert uniquement de bootstrap :
- `auto_https off` pour le développement local.
- En production, retirer cette directive ; Caddy gérera TLS via ACME (Let's Encrypt).
- La configuration opérationnelle (routes, upstreams) est injectée dynamiquement via
  `CaddyClient` depuis `apps/api/src/caddy/`.

## Agent (Sprint 2.3)

Le service `agent` (daemon Rust) est en commentaire dans `docker-compose.yml`.
Il sera activé une fois le Dockerfile `agent/Dockerfile` créé.
