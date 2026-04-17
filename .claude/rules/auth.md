# Auth — invariants

Passkey-only (WebAuthn). Aucun mot de passe dans le code. Source : `docs/adr/0002-auth-design.md`.

## Cookies

| Cookie | TTL | Flags |
|---|---|---|
| `ploydok_access` | 10 min | `HttpOnly; SameSite=Lax; Secure` (prod only) |
| `ploydok_refresh` | 7 j | `HttpOnly; SameSite=Lax; Secure` (prod only) |

- `Secure` **uniquement** en prod (`NODE_ENV=prod`). En dev (http://localhost), `Secure` casse les cookies.
- `SameSite=Lax` (pas Strict — TanStack SSR a besoin de forwarder les cookies sur les navigations initiales).

## JWT

- Access token signé par `SESSION_SECRET` (≥ 32 bytes, obligatoire en prod, auto-généré en dev si absent).
- Refresh rotatif : chaque usage émet un nouveau refresh et révoque l'ancien (anti-replay).
- Révoquer ≠ supprimer : table `sessions` marque `revoked_at`.

## CSRF

- Toutes les mutations (non-GET/HEAD/OPTIONS) exigent le header `X-CSRF-Token` qui matche le cookie CSRF.
- **Exception** : `POST /auth/refresh` est exempté (protégé par cookie `HttpOnly` + bind device).
- Origin check strict : `Origin` doit matcher `WEB_ORIGIN`.

## Front — `apiFetch`

- `apps/web/src/lib/api.ts` : auto-retry 1× sur 401 via `POST /auth/refresh`, puis ré-exécute la requête.
- SSR (`beforeLoad`, loaders) : `apiFetch` forward automatiquement le header `cookie` (lu via `getCookies()` de `@tanstack/react-start/server`, chargé en dynamic import gated par `typeof window`). Les rotations (Set-Cookie émises pendant le SSR, ex: refresh) sont persistées per-request via WeakMap<Request, overrides> — le retry in-flight voit les nouveaux cookies. **Ne pas** créer de fichier `.server.ts` séparé pour ça : le plugin `import-protection` de TanStack Start bloque les imports (statiques ET dynamiques) de `**/*.server.*` depuis le graphe client.
- Cache `GET /me` partagé sans TTL, invalidé **uniquement** sur 401 ou après mutation. Zéro polling.

## Front — guards de routes (layouts pathless)

L'auth est **centralisée dans deux layouts** (voir `.claude/rules/monorepo.md` § Routes) :

- `apps/web/src/routes/_authed.tsx` : `beforeLoad: async () => ({ me: await requireMe() })`. Toutes les routes authed vivent sous `_authed/...` et héritent du contexte `{ me }` via `Route.useRouteContext()`.
- `apps/web/src/routes/_public.tsx` : `beforeLoad: async () => { await redirectIfAuthenticated() }`. Routes publiques sous `_public/...` — un user loggé est bounce vers `/dashboard`.

Les helpers `requireMe()` et `redirectIfAuthenticated()` vivent dans `apps/web/src/lib/auth-guards.ts`. **Ne JAMAIS** les dupliquer dans une route enfant — le layout parent s'en charge.

## Backup codes

- Générés côté serveur, **bcrypt hashés** (cost ≥ 10), one-shot (marqués `consumed_at`).
- Le CLI Rust `ploydok-cli admin-recovery` est le dernier recours (requiert root sur l'host + path DB).

## Ne jamais

- Logger un cookie, un JWT, ou un backup code (même tronqué).
- Commiter `apps/api/.env.local`.
- Raccourcir les TTL sans migrer les sessions actives.
- Changer `SameSite` sans vérifier le flow SSR.
