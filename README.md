# Ploydok

> PaaS self-hosted giga-lite, security-first, AI-native. Alternative minimaliste à Dokploy / Coolify / Vercel.

**License**: AGPL-3.0-only · **Status**: pre-alpha (Sprint 1 — Fondations)

## Quickstart (< 5 min)

```bash
git clone git@github.com:MakFly/ploydok.git
cd ploydok
bun install                                 # ~30 s
bun --cwd packages/db run drizzle-kit migrate  # applies migrations to ./ploydok.db
bun --cwd packages/db run seed              # 1 dev user + 1 project
bun dev                                     # web (3000) + api (3001) via turbo
```

Open http://localhost:3000 and register with a passkey (WebAuthn).

### Requirements

- Bun ≥ 1.1
- Node ≥ 20 (tooling only)
- Rust ≥ 1.75 (only for `agent/ploydok-cli`)
- Docker (for integration tests from Sprint 2 onwards)

## Monorepo layout

```
ploydok/
├── apps/
│   ├── web/              # React + TanStack Start + shadcn
│   └── api/              # Bun + Hono + WebAuthn
├── packages/
│   ├── ui/               # shared shadcn components
│   ├── db/               # Drizzle ORM + SQLite schema + migrations
│   ├── shared/           # shared Zod schemas + types
│   └── agent-proto/      # TS stubs (filled Sprint 2)
├── agent/
│   └── ploydok-cli/      # Rust CLI (admin-recovery, more soon)
├── scripts/              # check-spdx.ts, tooling
└── project-docs/        # PRD, roadmap, decisions, operations docs
```

## Scripts

```bash
bun test             # turbo test across all packages
bun run typecheck    # turbo typecheck
bun run lint         # turbo lint
bun run check:spdx   # verify SPDX headers on source files
bun run db:migrate   # drizzle-kit migrate
bun run db:generate  # drizzle-kit generate (after schema changes)
```

Rust CLI:

```bash
cd agent/ploydok-cli
cargo test
cargo build --release
# emergency recovery (requires root on the host)
sudo ./target/release/ploydok-cli admin-recovery --db /var/lib/ploydok/ploydok.db
```

## Security

- Passkey-only authentication (WebAuthn), no passwords.
- JWT access 10 min + rotating refresh 7 d, cookies `HttpOnly; Secure; SameSite=Strict`.
- Backup codes (bcrypt, one-shot) for recovery; `admin-recovery` CLI as last resort.
- SPDX `AGPL-3.0-only` header enforced in CI.
- Responsible disclosure: see [SECURITY.md](./SECURITY.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) — DCO sign-off required (`git commit -s`).

## Roadmap

See [`project-docs/roadmap/README.md`](./project-docs/roadmap/README.md). 7 sprints to v1.0.
