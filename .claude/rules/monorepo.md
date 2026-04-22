# Monorepo — où vit quoi

```
apps/
├── api/            # Bun + Hono + WebAuthn + Drizzle + pino
│   └── src/
│       ├── index.ts          # entrypoint (port 3335)
│       ├── app.ts            # app Hono (middlewares, routes)
│       ├── env.ts            # Zod schema env (source de vérité)
│       ├── logger.ts         # pino
│       ├── mailer.ts         # nodemailer (smtp dev = mailpit 1025)
│       ├── keyring.ts        # keytar / MASTER_KEY
│       ├── auth/             # webauthn, jwt, sessions, middleware, backup-codes
│       ├── routes/           # auth, apps, github, ws
│       ├── queries/          # drizzle queries app-level
│       ├── caddy/            # client admin Caddy
│       ├── github/           # GitHub App (installs, webhooks)
│       ├── agent/            # client gRPC → agent Rust
│       └── worker/           # jobs async (build/deploy)
└── web/            # React 19 + TanStack Start (SSR) + Vite + shadcn + Tailwind v4
    └── src/
        ├── router.tsx
        ├── routeTree.gen.ts  # généré — NE PAS éditer à la main
        ├── routes/           # file-based routes TanStack (voir § Routes ci-dessous)
        ├── components/       # layout, apps, dashboard, errors
        └── lib/              # api.ts (fetch + refresh + SSR cookie forwarding), apps.ts, github.ts, auth-guards.ts

packages/
├── db/             # Drizzle ORM + Postgres (driver `postgres`) — migrations + schema + queries partagés
├── shared/         # Zod schemas + types partagés api↔web
├── ui/             # shadcn components partagés (+ globals.css Tailwind)
└── agent-proto/    # stubs TS gRPC (généré depuis les .proto de l'agent)

agent/              # workspace Cargo
├── ploydok-agent/  # daemon long-run (unix socket, gRPC)
├── ploydok-cli/    # CLI ops (admin-recovery, etc.)
└── crates/         # code partagé

infra/
├── docker-compose.yml     # caddy + buildkitd + registry
├── caddy/                 # Caddyfile + data volumes
├── buildkit/              # config buildkitd
└── registry/              # config registry v2

docs/
├── PRD.md
├── adr/           # Architecture Decision Records
├── sprints/       # sprint-N-*.md (roadmap)
├── plans/         # PLAN-sprint-N.md (plans d'implémentation)
└── runbooks/      # ops runbooks
```

## Règles de placement

- Type/schema Zod utilisé des deux côtés → `packages/shared/src/`.
- Composant shadcn réutilisé → `packages/ui/`. Composant spécifique à une page → `apps/web/src/components/<feature>/`.
- Query Drizzle utilisée par plusieurs routes → `packages/db/src/queries/`. Spécifique à l'API → `apps/api/src/queries/`.
- Jamais de dépendance cross `apps/*` — passer par `packages/*`.
- `routeTree.gen.ts` est généré par `@tanstack/router-plugin` — ne pas toucher. Régénération manuelle : `bunx --bun @tanstack/router-cli generate` (cwd `apps/web`).

## Routes (`apps/web/src/routes/`)

Arbo TanStack Router — deux layouts pathless centralisent l'auth, toutes les pages vivent dessous :

```
routes/
├── __root.tsx                   # HTML shell + providers globaux
├── _public.tsx                  # layout pathless — beforeLoad: redirectIfAuthenticated()
├── _public/
│   ├── index.tsx                # /             → redirect /login (les users loggés partent /dashboard via le layout)
│   ├── login.tsx                # /login
│   └── register.tsx             # /register
├── _authed.tsx                  # layout pathless — beforeLoad: requireMe() → { me }
└── _authed/
    ├── dashboard.tsx            # /dashboard
    ├── apps.tsx                 # /apps          (grille)
    ├── apps/
    │   └── $id.tsx              # /apps/$id      (layout header + tabs + Outlet)
    │   └── $id/
    │       ├── index.tsx        # /apps/$id      (redirect → overview)
    │       ├── overview.tsx     # /apps/$id/overview
    │       ├── logs.tsx         # /apps/$id/logs
    │       ├── builds.tsx       # /apps/$id/builds
    │       ├── settings.tsx     # /apps/$id/settings  (layout sub-tabs + Outlet)
    │       ├── settings/
    │       │   ├── index.tsx          # /apps/$id/settings/    (General — tous les champs build/deploy)
    │       │   ├── webhooks.tsx       # /apps/$id/settings/webhooks
    │       │   └── webhook-secret.tsx # /apps/$id/settings/webhook-secret
    │       ├── env.tsx          # /apps/$id/env
    │       └── domains.tsx      # /apps/$id/domains
    └── settings/
        ├── github.tsx           # /settings/github
        ├── security.tsx         # /settings/security  (layout sub-tabs + Outlet)
        └── security/
            ├── passkeys.tsx     # /settings/security/passkeys
            └── sessions.tsx     # /settings/security/sessions
```

### Conventions routing

| Pattern                  | Sens                                                                                 |
|--------------------------|--------------------------------------------------------------------------------------|
| `__root.tsx`             | racine spéciale (HTML doc, providers globaux)                                        |
| `_xxx.tsx` + dossier `_xxx/` | layout **pathless** — pas de segment URL, wrap les enfants (auth, providers, tabs) |
| `apps.tsx` + dossier `apps/` | layout/page `/apps` + children rendus via folder nesting                         |
| `$id`                    | segment dynamique                                                                    |
| `index.tsx`              | route racine de son dossier                                                          |
| `-xxx.test.ts`           | préfixe `-` → ignoré par le router (OK pour tests/helpers)                           |

### Règles

- **Nouvelle route authed** → créer sous `_authed/...`. Ne PAS remettre de `beforeLoad: requireMe` — le layout s'en charge. Pour lire `me` : `Route.useRouteContext()`.
- **Nouvelle route publique** (visible anonyme) → créer sous `_public/...`. Ne PAS appeler `redirectIfAuthenticated` — layout parent.
- Le `createFileRoute(...)` **doit inclure** le préfixe pathless : `"/_authed/dashboard"`, `"/_public/login"`, etc. TanStack enlève les `_xxx` à l'URL finale.
- Composant route-local → `apps/web/src/components/<feature>/`. Composant réutilisable → `packages/ui/`.
- Les guards `requireMe()` / `redirectIfAuthenticated()` vivent dans `apps/web/src/lib/auth-guards.ts` — ne pas dupliquer ailleurs.
