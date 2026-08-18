# Infra locale (`infra/`)

Docker Compose orchestre le control-plane local pour le développement :

| Service     | Rôle                                                                             | Port local                                |
| ----------- | -------------------------------------------------------------------------------- | ----------------------------------------- |
| `caddy`     | Reverse proxy + TLS. Admin API 2020.                                             | 8180 (http) / 8543 (https) / 2020 (admin) |
| `buildkitd` | Build OCI images (BuildKit). Adressé via `docker-container://ploydok-buildkitd`. | —                                         |
| `registry`  | Registry v2 local, push des images buildées.                                     | 5000                                      |
| `postgres`  | Base de données de développement.                                                | 5434                                      |
| `redis`     | File de travaux et données éphémères.                                            | 6381                                      |
| `agent`     | Frontière gRPC des opérations Docker privilégiées.                               | socket Unix                               |
| `adminer`   | UI de diagnostic DB locale.                                                      | via Caddy                                 |

## Commandes

```bash
make infra-up       # docker network create ploydok-public + compose up -d
make infra-down     # compose down + cleanup network
make infra-logs     # tail caddy logs
```

Les réseaux `ploydok-public`/`ploydok-ingress` sont créés par `infra-up` pour
le développement. Ne pas étendre ces réseaux par commodité : les workloads et
les interfaces d'administration doivent conserver les frontières définies par
le compose et par le descriptor de production.

## Caddy

- Config dynamique via Admin API `http://127.0.0.1:2020/config/`. L'API Ploydok (`apps/api/src/caddy/client.ts`) patche la config — **ne pas** éditer le `Caddyfile` statique à la main pour le dev.
- Data volume : `infra/caddy/data` (certs Let's Encrypt en prod). Ne pas commiter le contenu.

## BuildKit

- Daemon : container `ploydok-buildkitd`. L'API parle au daemon BuildKit ; les
  opérations Docker privilégiées restent déléguées à l'agent.
- Build dir côté API : `~/.ploydok-dev/builds/` (var `PLOYDOK_BUILD_DIR`). Garbage-collecté périodiquement — ne pas y stocker de données persistantes.

## Registry

- `http://127.0.0.1:5000` — pas d'auth en dev. Vérifier le catalogue : `curl http://127.0.0.1:5000/v2/_catalog`.
- Credentials prod : `PLOYDOK_REGISTRY_USER/PASS` (env API).

## Règles

- **Ne pas** toucher aux ports 80/443/3000 (occupés par d'autres services sur la machine dev).
- **Ne pas** ajouter un service au compose sans mettre à jour `commands.md` + `make infra-up` → reste la source de vérité.
- Tester `make infra-up && make infra-down` est idempotent avant de commiter une modif compose.
- Secrets prod (mTLS certs, registry creds) : **jamais** dans le repo. Passer par env + secret manager.
