# Commandes & ports

## Ports réservés (ne pas utiliser 80/443/3000)

| Service                   | Port / socket                                   |
| ------------------------- | ----------------------------------------------- |
| API (Hono)                | `http://localhost:3335`                         |
| Web (Vite/TanStack Start) | `http://localhost:5173`                         |
| Postgres                  | `127.0.0.1:5434` (container `ploydok-postgres`) |
| Redis                     | `127.0.0.1:6381` (container `ploydok-redis`)    |
| Caddy data                | `8180` (http) / `8543` (https)                  |
| Caddy admin               | `http://127.0.0.1:2020/config/`                 |
| BuildKit                  | `docker-container://ploydok-buildkitd`          |
| Registry v2               | `http://127.0.0.1:5000/v2/`                     |
| Agent Rust                | `unix:///tmp/ploydok-agent.sock`                |

## Domaine des apps en dev

Base par défaut : **`demo.localhost`** (`deriveDefaultAppDomainBase`, `apps/api/src/routes/apps.ts`).
Une app déployée est donc joignable sur `http://<slug>-<id>.demo.localhost:8180/`.

`.localhost` résout vers la loopback sans DNS ni `/etc/hosts`, wildcards compris.
Ne **pas** revenir à un TLD `.local` : la plupart des `nsswitch.conf` Linux routent
ces noms vers mDNS avec `[NOTFOUND=return]`, la résolution s'arrête là et n'atteint
jamais le resolver DNS. Caddy sert correctement, mais le navigateur n'arrive pas.

Domaines créés avant la bascule : `bun run scripts/rebase-dev-domains.ts --apply`
(réécrit `apps.domain` + `domains.hostname` et repatche la route Caddy ; dry run par défaut).

## Processus dev — interdits pour Claude

**Ne jamais lancer, build-watch, ni tuer les process longs** : `make install`, `make dev`, `bun run dev`, `bun run --watch`, `nohup` API/web, `kill` d'un process dev. Seul l'utilisateur s'en charge. `make install` enchaîne sur `make dev` à la fin : il reste au premier plan, donc il est interdit lui aussi. Claude peut :

- **Proposer** la commande à taper (ex. : « relance `make dev` dans un autre shell »).
- **Lancer** des one-shots : `bun test`, `bun run typecheck`, `bun run lint`, `make db-ensure-auth`, `make db-migrate`, `curl` contre un serveur déjà up. Pour rejouer le setup sans démarrer les serveurs : `make infra-up && make db-ensure-auth && make db-migrate`.

Si une vérif nécessite que le serveur tourne, d'abord **demander** si API:3335 / Web:5173 est up — ne pas le démarrer soi-même.

## Makefile (source de vérité pour le dev)

```bash
make install        # setup complet PUIS démarrage : deps + infra + auth + migrations + dev
make dev            # turbo dev → web:5173 + api:3335
make dev-agent      # agent Rust (insecure, socket /tmp/ploydok-agent.sock)
make db-ensure-auth # attend Postgres + réaligne le rôle si le volume a dérivé
make db-migrate     # drizzle-kit migrate sur Postgres (DATABASE_URL de .env.local)
make secrets-init  # génère PLOYDOK_PG_PASSWORD/REDIS + DATABASE_URL/REDIS_URL dans .env.local
make infra-up      # docker compose : postgres + redis + caddy + buildkitd + registry
make infra-down    # cleanup infra
make infra-logs    # tail logs caddy
make dod           # lance les 11 specs Playwright DoD Sprint 3 (requiert infra + agent + dev up)
make build | test | lint | typecheck | clean
```

## Workspace (Bun + Turbo uniquement — jamais npm/pnpm/yarn)

```bash
bun install                       # racine
bun --cwd apps/api run dev        # API seule
bun --cwd apps/web run dev        # Web seule
bun --cwd packages/db run migrate
bun --cwd packages/db run seed
bun run check:spdx                # lint SPDX headers
```

Turbo délègue `build|lint|typecheck|test|dev` via `turbo.json`. Tâche `test` dépend de `^build`.

## Secrets dev

`apps/api/.env.local` (gitignored). **Ne jamais régénérer `SESSION_SECRET` sans prévenir** — ça invalide tous les JWT existants. Variables parsées par `apps/api/src/env.ts` (Zod).
