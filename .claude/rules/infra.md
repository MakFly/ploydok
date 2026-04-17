# Infra locale (`infra/`)

Docker Compose orchestre trois services pour le dev :

| Service | Rôle | Port local |
|---|---|---|
| `caddy` | Reverse proxy + TLS. Admin API 2020. | 8180 (http) / 8543 (https) / 2020 (admin) |
| `buildkitd` | Build OCI images (BuildKit). Adressé via `docker-container://ploydok-buildkitd`. | — |
| `registry` | Registry v2 local, push des images buildées. | 5000 |

## Commandes

```bash
make infra-up       # docker network create ploydok-public + compose up -d
make infra-down     # compose down + cleanup network
make infra-logs     # tail caddy logs
```

Réseau Docker : `ploydok-public` (créé par `infra-up`). Tous les services applicatifs (y compris containers spawn par l'agent) doivent y être joints.

## Caddy

- Config dynamique via Admin API `http://127.0.0.1:2020/config/`. L'API Ploydok (`apps/api/src/caddy/client.ts`) patche la config — **ne pas** éditer le `Caddyfile` statique à la main pour le dev.
- Data volume : `infra/caddy/data` (certs Let's Encrypt en prod). Ne pas commiter le contenu.

## BuildKit

- Daemon : container `ploydok-buildkitd-1`. L'API envoie les frontend LLB via `buildctl` ou API native.
- Build dir côté API : `~/.ploydok-dev/builds/` (var `PLOYDOK_BUILD_DIR`). Garbage-collecté périodiquement — ne pas y stocker de données persistantes.

## Registry

- `http://127.0.0.1:5000` — pas d'auth en dev. Vérifier le catalogue : `curl http://127.0.0.1:5000/v2/_catalog`.
- Credentials prod : `PLOYDOK_REGISTRY_USER/PASS` (env API).

## Règles

- **Ne pas** toucher aux ports 80/443/3000 (occupés par d'autres services sur la machine dev).
- **Ne pas** ajouter un service au compose sans mettre à jour `commands.md` + `make infra-up` → reste la source de vérité.
- Tester `make infra-up && make infra-down` est idempotent avant de commiter une modif compose.
- Secrets prod (mTLS certs, registry creds) : **jamais** dans le repo. Passer par env + secret manager.
