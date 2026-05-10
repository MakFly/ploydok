# Ploydok

> PaaS self-hosted giga-lite, security-first, AI-native. Alternative minimaliste à Dokploy / Coolify / Vercel.

**License**: AGPL-3.0-only · **Status**: pre-alpha (Sprint 1 — Fondations)

## Self-host install (one-liner)

```bash
curl -fsSL https://raw.githubusercontent.com/MakFly/ploydok/main/installer/bootstrap.sh | sudo bash
```

Or with flags:

```bash
curl -fsSL https://raw.githubusercontent.com/MakFly/ploydok/main/installer/bootstrap.sh \
  | sudo bash -s -- --mode=coexist --yes
```

> Once the domain is live, the alias will be `curl -fsSL https://install.ploydok.dev | sudo bash`. The bootstrap URL above keeps working in the meantime.

What it does:

- Clones the repo into `/opt/ploydok-installer` (shallow).
- Runs `installer/install.sh` which:
  - **Installs Docker** automatically via [`get.docker.com`](https://get.docker.com) if missing (skip with `--skip-docker-install`).
  - Creates the `ploydok` system user, keeps runtime descriptors in `/opt/ploydok`, and keeps mutable data under `/var/lib/ploydok/{data,builds,backups,certs,…}`.
  - Generates secrets (`master.key`, `.env` with `SESSION_SECRET`, Postgres/Redis passwords) and a local mTLS CA for the agent.
  - Pulls + verifies (cosign) the `ploydok-api`, `ploydok-web`, `ploydok-agent`, `ploydok-adminer`, `ploydok-caddy` images.
  - Renders systemd units (`ploydok.target`) and `/opt/ploydok/docker-compose.yml`.
  - **Installs the agent and the platform** as Docker services supervised by systemd — the agent runs as a long-lived daemon container (`ploydok-agent`) on Docker-internal TCP with mTLS.
  - **Installs the `ploydok-cli`** (upgrade / uninstall) to `/usr/local/bin/ploydok-cli`.
  - Starts everything via `systemctl enable --now ploydok.target` and waits for `/health`.

Modes (`--mode=`):

- `takeover` — Ploydok takes ports 80/443 (existing nginx/apache configs are backed up under `/var/backups/ploydok-install/` then disabled).
- `coexist` — Ploydok binds to `127.0.0.1:8080`/`8443`; your existing edge proxy keeps TLS.
- `bootstrap-http` — Ploydok exposes HTTP on `0.0.0.0:8080` for first setup from an IP-allowlisted VPS security group. Use `--public-host=<server-ip>` and move to a real HTTPS domain after bootstrap.
- `abort` — preflight report only, exits with code 2.

Other useful flags: `--unattended` (forces `coexist` + `--yes`, IaC-friendly), `--manage-firewall`, `--public-host=…`, `--public-scheme=…`, `--public-port=…`, `--http-port=…`, `--https-port=…`, `--install-dir=…`, `--data-dir=…`, `--version=<tag>`, `--image-registry=<registry>`.

Full docs: [`project-docs/operations/install/getting-started.md`](./project-docs/operations/install/getting-started.md).

## Updating without downtime

Run the installed CLI on the host:

```bash
sudo ploydok-cli upgrade --version=1.2.3
```

What gets restarted, what doesn't:

| Component | On `upgrade` | Notes |
|---|---|---|
| `ploydok-api`, `ploydok-web`, `ploydok-agent`, `ploydok-adminer` | restarted (~5–15 s) | new image pulled and rolled via `docker compose up -d --no-deps api web agent adminer` |
| `ploydok-caddy` | **not restarted** by default | use `--include-data-plane` only for ingress/Caddy releases |
| `postgres`, `redis` | **not** restarted unless their image tag changed | most patch releases never touch them |
| **Your deployed apps** (containers spawned by the agent) | **not touched** | they keep serving traffic the entire time |
| **Your databases provisioned via Ploydok** | **not touched** | same |

Safety net (built into the CLI):

- Snapshot of the Postgres control-plane DB taken before upgrade → `/var/lib/ploydok/backups/pre-upgrade-<version>.sql`.
- `/opt/ploydok/docker-compose.yml` backed up to `/var/lib/ploydok/backups/docker-compose.pre-upgrade-<version>.yml`.
- Post-upgrade readiness check on `127.0.0.1:3335/health/ready` (60 s budget). If it fails the previous compose file is restored and services are brought back up.
- Image signatures verified with `cosign verify` before pull.

The control-plane (UI / API) has a brief 5–15 s cold window during the swap. Apps and databases keep serving because their containers and the Caddy ingress stay outside normal platform image rolls.

If a release intentionally changes the ingress/data-plane image, run:

```bash
sudo ploydok-cli upgrade --version=1.2.3 --include-data-plane
```

That path may interrupt active HTTP/WebSocket connections and should be treated as a maintenance operation.

To uninstall:

```bash
sudo ploydok-cli uninstall --yes                          # stops + tarballs /var/lib/ploydok
sudo ploydok-cli uninstall --yes --restore-previous-proxy # also restores the original nginx/apache config
```

## Quickstart (< 5 min)

```bash
git clone git@github.com:MakFly/ploydok.git
cd ploydok
bun install                                 # ~30 s
bun --cwd packages/db run drizzle-kit migrate  # applies migrations to ./ploydok.db
bun --cwd packages/db run seed              # 1 dev user + 1 project
bun dev                                     # web (3000) + api (3001) via turbo
```

Open http://localhost:3000 and create the first admin account.

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

- Password-first bootstrap/login, with passkeys available after the instance has a trusted HTTPS origin.
- JWT access 10 min + rotating refresh 7 d, cookies `HttpOnly; SameSite=Lax`; `Secure` follows the configured public origin.
- Backup codes (bcrypt, one-shot) for recovery; `admin-recovery` CLI as last resort.
- SPDX `AGPL-3.0-only` header enforced in CI.
- Responsible disclosure: see [SECURITY.md](./SECURITY.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) — DCO sign-off required (`git commit -s`).

## Roadmap

See [`project-docs/roadmap/README.md`](./project-docs/roadmap/README.md). 7 sprints to v1.0.
