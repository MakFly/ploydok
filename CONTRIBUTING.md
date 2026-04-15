# Contributing to Ploydok

Thanks for your interest in Ploydok. This project is AGPL-3.0-only — by contributing you agree your work is licensed under the same terms.

## Setup

```bash
bun install
bun db:migrate   # once the db package is wired
bun dev          # runs web + api
```

Requirements: Bun ≥ 1.1, Node ≥ 20 (for tooling only), Docker (for integration tests from sprint 2).

## Developer Certificate of Origin (DCO)

All commits must be **signed-off**:

```bash
git commit -s -m "feat(foo): do the thing"
```

This appends a `Signed-off-by:` trailer certifying you have the right to submit the contribution under AGPL-3.0-only (see https://developercertificate.org).

PRs with unsigned commits will be blocked by CI.

## Commit style

Conventional Commits:

- `feat(scope): …` — new feature
- `fix(scope): …` — bug fix
- `chore(scope): …` — tooling, deps
- `docs(scope): …` — docs only
- `refactor(scope): …` — no behavior change
- `test(scope): …` — tests only
- `ci(scope): …` — CI / workflows

One focused change per commit when reasonable.

## SPDX headers

Every source file (`.ts`, `.tsx`, `.rs`) must start with:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
```

The `scripts/check-spdx.ts` linter enforces this in CI. Run it locally with `bun run check:spdx`.

## Pull requests

- Open one PR per focused change
- Ensure `bun lint`, `bun typecheck`, `bun test`, `bun run check:spdx` all pass
- Update docs when behavior changes
- Add or update tests for any code change
- Reference the sprint / issue in the PR description

## Security

Do **not** open issues for security bugs. See [SECURITY.md](./SECURITY.md).

## Code of Conduct

This project adheres to the Contributor Covenant 2.1. See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
