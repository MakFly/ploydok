# DB — Drizzle + SQLite

DB de dev : `./ploydok.db` à la racine du repo (gitignored sauf fichier vide de seed ? — vérifier `.gitignore`).

## Workflow modif schema

1. Édite le schema : `packages/db/src/schema/*.ts` (un fichier par domaine : `apps.ts`, `auth.ts`, …).
2. Expose dans `packages/db/src/schema/index.ts`.
3. Génère la migration : `bun --cwd packages/db run generate`.
4. Relis le SQL produit dans `packages/db/migrations/NNNN_*.sql` — drizzle-kit peut générer des DROP surprenants. Corrige à la main si besoin.
5. Applique : `make db-migrate` (ou `bun --cwd packages/db run migrate`).
6. Commit **schema + migration ensemble** dans le même commit.

## Queries

- Partagées (utilisées par plusieurs routes ou par le worker) : `packages/db/src/queries/`.
- Spécifiques à un domaine API : `apps/api/src/queries/`.
- Toujours typer le retour — pas de `any` sur un `.select()`.
- Préfère `db.transaction()` pour toute séquence read-then-write.

## Migrations

- Fichiers versionnés dans `packages/db/migrations/`. Le journal `meta/_journal.json` est managed par drizzle-kit.
- **Jamais** éditer une migration déjà appliquée en prod — en créer une nouvelle.
- Seed dev : `bun --cwd packages/db run seed` (1 user + 1 project).

## Tests

- Tests unitaires schema/queries : à côté du code (`*.test.ts`), pas de DB réelle — préfère `:memory:` via libsql.
- Tests d'intégration qui touchent la vraie DB : marquer `*.e2e.test.ts`.
