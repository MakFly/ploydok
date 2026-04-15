# CLAUDE.md — Ploydok

## Règles de travail

- **Toujours tester en local avant tout push GitHub.** Aucun `git push` n'est autorisé tant que la DoD du sprint n'est pas vérifiée bout en bout (tests unitaires + e2e réels, pas seulement type-check).
- **Dev local** : `make dev` (web + api via turbo). Infra optionnelle : `make infra-up`, `make dev-agent`. Migrations : `make db-migrate`.
- **Ports locaux réservés** : API 4000, Web 5173, Caddy 8180/8543/2020, Agent `/tmp/ploydok-agent.sock`. Ne pas toucher 80/443/3000 (occupés par d'autres services de la machine dev).
- **Secrets dev** : `apps/api/.env.local` (gitignored). Ne jamais régénérer sans prévenir — ça invalide tous les JWT.
- **Cookies auth** : `SameSite=Lax`, `Secure` uniquement en prod. `ploydok_access` 10 min, `ploydok_refresh` 7j (HttpOnly).
- **Refresh** : exempté CSRF côté serveur (protégé par cookie HttpOnly). Front auto-retry 1× sur 401 via `/auth/refresh`.
- **SSR TanStack Start** : `apiFetch` forward le header `cookie` via `@tanstack/react-start/server` → obligatoire pour `beforeLoad`.
- **Cache GET `/me`** : partagé sans TTL, invalidé sur 401 + toute mutation. Zéro polling.
