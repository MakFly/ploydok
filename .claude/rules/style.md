# Style

## Prettier (`.prettierrc`)

- `semi: false` — pas de `;` finaux.
- `singleQuote: false` — guillemets doubles `"`.
- `tabWidth: 2`, `printWidth: 80`, `trailingComma: "es5"`.
- `endOfLine: "lf"`.
- Plugin `prettier-plugin-tailwindcss` trie les classes. `cn` et `cva` sont reconnus — les utiliser pour composer les classes dynamiques.

## ESLint

- Web : `@tanstack/eslint-config` (flat config `apps/web/eslint.config.mjs`).
- API / packages : pas de eslint dédié — se fier à `tsc` strict + prettier.
- Lancer : `bun run lint` (turbo délègue aux packages).

## TypeScript

- `tsconfig.base.json` à la racine, `strict: true`. Ne pas relâcher localement.
- Pas de `any`. Utiliser `unknown` + narrow, ou un type précis.
- Pas de `// @ts-ignore` / `// @ts-expect-error` sans commentaire qui explique **pourquoi** et un TODO.
- Préférer `type` pour les unions/alias, `interface` pour les objets étendus.
- Import paths : `@ploydok/*` (workspaces) — jamais d'import relatif cross-package (`../../../packages/...`).

## React / TanStack

- React 19. Server components **non** utilisés (TanStack Start gère SSR via loaders/beforeLoad).
- Préférer `useSuspenseQuery` + route loader à `useEffect` pour fetch initial.
- Forms : Zod schemas de `packages/shared/` côté validation — ne jamais dupliquer les schemas entre front et back.
- Toute action mutante (POST/PUT/PATCH/DELETE, submit, deploy, sync) passe par `<Button loading={mutation.isPending}>` : spinner + `disabled` + `aria-busy` gérés par le primitive. Règle complète dans `CLAUDE.md` § Button Loading State.

## Commentaires

- Par défaut : **pas** de commentaire. Un bon nom + une signature typée suffisent.
- Écrire un commentaire uniquement si le _pourquoi_ n'est pas évident : contrainte cachée, workaround pour un bug tiers, invariant subtil.
- Pas de JSDoc décoratif (`/** The name of the user */ name: string`).
- Pas de référence à une PR/tâche dans le code (`// added for #123`) — ça appartient au commit message.

## Tailwind

- Tailwind v4 (config via CSS, pas JS). `packages/ui/src/styles/globals.css` est la source.
- Classes longues → `cn(...)` + découpage par état. Éviter les string template imbriquées.
