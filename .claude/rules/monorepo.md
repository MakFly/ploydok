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
│       ├── routes/           # HTTP auth, apps, orgs, providers, billing, ops
│       ├── caddy/            # client admin Caddy
│       ├── github/           # GitHub App (installs, webhooks)
│       ├── gitlab/           # client et synchronisation GitLab
│       ├── observability/    # santé, readiness et métriques
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
├── ploydok-cli/    # CLI Rust audit + récupération historique (SQLite)
└── crates/         # code partagé

infra/
├── docker-compose.yml     # control-plane local complet
├── adminer/               # image Adminer durcie
├── caddy/                 # Caddyfile + data volumes
├── buildkit/              # config buildkitd
├── garage/                # stockage S3 compatible pour le dev
└── registry/              # config registry v2

installer/                   # bootstrap, CLI shell et descriptors VPS
PRD-PLAN.md                  # scope et gates de production actifs
PRODUCT.md                   # contexte produit et principes UX
```

## Règles de placement

- Type/schema Zod utilisé des deux côtés → `packages/shared/src/`.
- Composant shadcn réutilisé → `packages/ui/`. Composant spécifique à une page → `apps/web/src/components/<feature>/`.
- Query Drizzle réutilisable → `packages/db/src/queries/`. Une lecture propre à
  un handler peut rester dans son module de route ; ne pas recréer une couche
  `apps/api/src/queries/` parallèle.
- Jamais de dépendance cross `apps/*` — passer par `packages/*`.
- `routeTree.gen.ts` est généré par `@tanstack/router-plugin` — ne pas toucher. Régénération manuelle : `bunx --bun @tanstack/router-cli generate` (cwd `apps/web`).

## Routes (`apps/web/src/routes/`)

Arbo TanStack Router — deux layouts pathless centralisent l'auth. Les pages
métier sont principalement scopées par organisation :

```
routes/
├── __root.tsx                   # HTML shell + providers globaux
├── _public.tsx                  # layout pathless — beforeLoad: redirectIfAuthenticated()
├── _public/
│   ├── index.tsx                # /
│   ├── login.tsx                # /login
│   ├── setup.tsx                # /setup
│   └── invitations/accept.tsx   # /invitations/accept
├── onboarding.tsx               # /onboarding, garde dédiée au parcours initial
├── _authed.tsx                  # layout pathless — beforeLoad: requireMe() → { me }
└── _authed/
    ├── dashboard.tsx            # redirect vers le workspace par défaut
    ├── admin/                    # surfaces réservées à l'admin de l'instance
    ├── orgs/$orgSlug.tsx        # layout du workspace
    ├── orgs/$orgSlug/           # apps, DB, services, membres, settings, ops
    └── settings/
        ├── git-providers/       # connexions GitHub et GitLab personnelles
        ├── notifications.tsx
        ├── registry.tsx
        └── security/            # passkeys, TOTP, sessions et posture
```

### Conventions routing

| Pattern                      | Sens                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `__root.tsx`                 | racine spéciale (HTML doc, providers globaux)                                      |
| `_xxx.tsx` + dossier `_xxx/` | layout **pathless** — pas de segment URL, wrap les enfants (auth, providers, tabs) |
| `apps.tsx` + dossier `apps/` | layout/page `/apps` + children rendus via folder nesting                           |
| `$id`                        | segment dynamique                                                                  |
| `index.tsx`                  | route racine de son dossier                                                        |
| `-xxx.test.ts`               | préfixe `-` → ignoré par le router (OK pour tests/helpers)                         |

### Règles

- **Nouvelle route authed** → créer sous `_authed/...`, et sous
  `_authed/orgs/$orgSlug/...` si la ressource appartient à un workspace. Ne PAS
  remettre de `beforeLoad: requireMe` — le layout s'en charge.
- **Nouvelle route publique** (visible anonyme) → créer sous `_public/...`. Ne PAS appeler `redirectIfAuthenticated` — layout parent.
- Le `createFileRoute(...)` **doit inclure** le préfixe pathless : `"/_authed/dashboard"`, `"/_public/login"`, etc. TanStack enlève les `_xxx` à l'URL finale.
- Composant route-local → `apps/web/src/components/<feature>/`. Composant réutilisable → `packages/ui/`.
- Les guards `requireMe()` / `redirectIfAuthenticated()` vivent dans `apps/web/src/lib/auth-guards.ts` — ne pas dupliquer ailleurs.
