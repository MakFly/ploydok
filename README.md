# Ploydok - Self-Hosted PaaS for Docker, Git Deploys, Databases and Blue/Green Rollouts

[![CI](https://github.com/MakFly/ploydok/actions/workflows/ci.yml/badge.svg)](https://github.com/MakFly/ploydok/actions/workflows/ci.yml)
[![Integration](https://github.com/MakFly/ploydok/actions/workflows/ci-integration.yml/badge.svg)](https://github.com/MakFly/ploydok/actions/workflows/ci-integration.yml)
[![Release images](https://github.com/MakFly/ploydok/actions/workflows/release-images.yml/badge.svg)](https://github.com/MakFly/ploydok/actions/workflows/release-images.yml)
[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](./LICENSE)
[![Runtime: Docker Swarm](https://img.shields.io/badge/runtime-Docker%20Swarm-2496ED.svg)](https://docs.docker.com/engine/swarm/)
[![Stack: Bun Hono React](https://img.shields.io/badge/stack-Bun%20%2B%20Hono%20%2B%20React-black.svg)](./package.json)

Ploydok is an open-source, security-first, self-hosted PaaS for deploying web
applications, APIs, background services and databases on your own VPS. It is
designed as a pragmatic alternative to Dokploy, Coolify, CapRover, Heroku,
Railway, Render and Vercel for teams that want Git-based deploys, Docker
runtime control, blue/green rollouts, framework guardrails and clear operations
without running Kubernetes.

Ploydok focuses on the daily production workflow: connect a repository, deploy
an app, attach domains and databases, scale replicas, inspect logs, monitor
runtime health, recover safely, and keep the host clean over time.

## Table of Contents

- [Why Ploydok](#why-ploydok)
- [Features](#features)
- [Supported Stacks](#supported-stacks)
- [Install on a VPS](#install-on-a-vps)
- [Zero-Downtime Updates](#zero-downtime-updates)
- [Local Development](#local-development)
- [Architecture](#architecture)
- [Security Model](#security-model)
- [SEO Keywords](#seo-keywords)
- [Contributing](#contributing)

## Why Ploydok

Ploydok is built for operators who want a small, inspectable deployment
platform instead of a large cluster stack.

| Need                         | Ploydok approach                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| Deploy from GitHub or GitLab | Repository import, branch tracking, webhook deploys and preview flows              |
| Run many frameworks          | Dockerfile, Nixpacks and framework-specific env guardrails                         |
| Scale apps over time         | Docker Swarm services, replicas, service updates and runtime monitoring            |
| Avoid downtime on deploy     | Blue/green runtime model and Swarm `start-first` updates                           |
| Keep storage under control   | Runtime image cleanup, registry garbage collection and build cache hygiene         |
| Operate from a VPS           | One-line installer, systemd supervision, Caddy ingress, Postgres and Redis         |
| Keep accounts secure         | Password login, TOTP, backup codes, passkeys on HTTPS origins and session controls |

Use Ploydok if you want a self-hosted PaaS for a single server or small fleet,
with practical production defaults and no Kubernetes dependency.

## Features

### Application Deployments

- Deploy web apps, APIs and services from Git repositories.
- Dockerfile and Nixpacks build paths.
- Framework detection from repository files and manifests.
- Runtime env and secret handling for build-time and runtime phases.
- Production deployments and preview deployments.
- GitHub/GitLab provider integration and webhook-driven auto-deploy.

### Scaling and Rollouts

- Docker Swarm runtime mode for long-lived application services.
- Replica scaling per application.
- Blue/green deployment model.
- `start-first` updates for cleaner reloads.
- Healthcheck-aware deployment status.
- Runtime reconciliation so stale DB state follows real running services.

### Framework Guardrails

Ploydok adds framework-aware defaults before deploy so common 502s are caught
or repaired early.

- Laravel: `APP_KEY`, safe cache/session defaults when no external store exists.
- Symfony: `APP_SECRET`, `APP_ENV=prod`, `APP_DEBUG=0`.
- PHP: runtime port and web-root handling.
- Next.js: Node runtime defaults and container host binding.
- Hono and Node APIs: host/port/runtime guardrails.
- Python: Django, Flask and FastAPI process defaults.
- Rails and Phoenix: secret key checks.

### Databases and Services

- Provisioned databases managed as runtime resources.
- Connection reveal and database env injection.
- Adminer integration for database inspection.
- Runtime monitoring for app and database containers.

### Observability

- Workspace dashboard with application status, service health and deploy history.
- Monitoring page for runtime status, CPU, memory, uptime, restarts and images.
- Runtime logs and live status updates.
- Health pings and stale/offline agent states.

### Security and Operations

- Password login, TOTP, backup codes and passkey enrollment.
- WebAuthn passkeys on trusted HTTPS origins.
- HttpOnly access and refresh cookies.
- mTLS between API and agent in production TCP mode.
- Image signature verification in installer flows.
- Host CLI for upgrade, uninstall and recovery operations.

## Supported Stacks

Ploydok is framework-friendly rather than framework-locked. It can deploy any
containerized workload and has extra guardrails for popular stacks.

| Ecosystem                 | Examples                                               |
| ------------------------- | ------------------------------------------------------ |
| JavaScript and TypeScript | Next.js, Hono, Node.js APIs, React frontends           |
| PHP                       | Laravel, Symfony, generic PHP apps                     |
| Python                    | FastAPI, Flask, Django                                 |
| Ruby                      | Rails                                                  |
| Elixir                    | Phoenix                                                |
| JVM                       | Spring Boot through Dockerfile or build tooling        |
| Custom                    | Any app with a Dockerfile or compatible Nixpacks build |

## Install on a VPS

Install Ploydok on a Debian or Ubuntu VPS with one command:

```bash
curl -fsSL https://raw.githubusercontent.com/MakFly/ploydok/main/installer/bootstrap.sh | sudo bash
```

Install in coexist mode when another proxy already owns ports 80 and 443:

```bash
curl -fsSL https://raw.githubusercontent.com/MakFly/ploydok/main/installer/bootstrap.sh \
  | sudo bash -s -- --mode=coexist --yes
```

The installer:

- clones the installer into `/opt/ploydok-installer`;
- installs Docker when missing, unless `--skip-docker-install` is provided;
- creates the `ploydok` system user;
- writes runtime descriptors under `/opt/ploydok`;
- stores mutable data under `/var/lib/ploydok`;
- generates platform secrets and mTLS material;
- pulls and verifies platform images;
- renders Docker Compose and systemd units;
- starts the platform and waits for health checks;
- installs `ploydok-cli` on the host.

### Install Modes

| Mode             | Use when                                                                        |
| ---------------- | ------------------------------------------------------------------------------- |
| `takeover`       | Ploydok should own ports 80 and 443. Existing nginx/apache config is backed up. |
| `coexist`        | Another edge proxy keeps TLS and forwards to Ploydok on local ports.            |
| `bootstrap-http` | Temporary first setup over HTTP from a controlled VPS security group.           |
| `abort`          | Preflight only. Prints what would happen and exits.                             |

Useful flags:

```bash
--unattended
--manage-firewall
--public-host=example.com
--public-scheme=https
--public-port=443
--http-port=8080
--https-port=8443
--install-dir=/opt/ploydok
--data-dir=/var/lib/ploydok
--version=<tag>
--image-registry=<registry>
```

For production, use a real HTTPS domain. Browser passkeys require a secure
WebAuthn-compatible origin. Raw HTTP on an IP address is only suitable for
temporary bootstrap access.

## Zero-Downtime Updates

Run upgrades from the host with the installed CLI:

```bash
sudo ploydok-cli upgrade --version=1.2.3
```

Default upgrades roll the control plane and keep the data plane stable.

| Component                                                        | During `upgrade`                       | Notes                                            |
| ---------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------ |
| `ploydok-api`, `ploydok-web`, `ploydok-agent`, `ploydok-adminer` | restarted                              | New images are pulled and applied.               |
| `ploydok-caddy`                                                  | not restarted by default               | Use `--include-data-plane` for ingress releases. |
| `postgres`, `redis`                                              | not restarted unless image tags change | Patch releases usually leave them alone.         |
| User apps                                                        | not touched                            | Runtime app containers keep serving traffic.     |
| User databases                                                   | not touched                            | Provisioned databases keep running.              |

Safety checks:

- control-plane database snapshot before upgrade;
- compose file backup before upgrade;
- image signature verification;
- readiness check after upgrade;
- rollback to the previous compose file if readiness fails.

Uninstall while preserving data as a tarball:

```bash
sudo ploydok-cli uninstall --yes
```

Restore a previous nginx/apache edge proxy as part of uninstall:

```bash
sudo ploydok-cli uninstall --yes --restore-previous-proxy
```

## Local Development

Requirements:

- Bun 1.3 or newer
- Node.js 22 or newer for tooling
- Docker
- Rust stable for the agent and host CLI

Install dependencies:

```bash
bun install
```

Start local infrastructure:

```bash
make infra-up
```

Apply migrations:

```bash
make db-migrate
```

Run the development servers:

```bash
make dev
```

Local ports:

| Service        | URL                             |
| -------------- | ------------------------------- |
| Web            | `http://localhost:5173`         |
| API            | `http://localhost:3335`         |
| Caddy admin    | `http://127.0.0.1:2020/config/` |
| Local registry | `http://127.0.0.1:5000/v2/`     |
| Postgres       | `127.0.0.1:5434`                |
| Redis          | `127.0.0.1:6381`                |

Useful commands:

```bash
bun test
bun run typecheck
bun run lint
bun run check:spdx
bun run db:migrate
bun run db:generate
```

Agent and host CLI:

```bash
cd agent
cargo test
cargo build --release
```

## Architecture

```text
ploydok/
├── apps/
│   ├── web/              # React 19, TanStack Start, TanStack Router
│   └── api/              # Bun, Hono, queues, auth, providers
├── packages/
│   ├── db/               # Drizzle schema and migrations
│   ├── shared/           # shared Zod schemas and domain types
│   ├── ui/               # shared UI components
│   └── agent-proto/      # gRPC contract and generated client types
├── agent/                # Rust agent and host CLI
├── installer/            # VPS installer, systemd and host templates
├── infra/                # local Postgres, Redis, Caddy, registry, BuildKit
└── scripts/              # validation and maintenance scripts
```

Runtime overview:

```text
Browser
  -> Ploydok web
  -> Ploydok API
  -> Rust agent over mTLS
  -> Docker / Docker Swarm
  -> App containers, database containers and Caddy routes
```

## Security Model

Ploydok is designed for production self-hosting, not only local demos.

- Access token: 10 minutes.
- Refresh token: 7 days, rotating.
- Cookies: `HttpOnly`, `SameSite=Lax`, `Secure` when public origin is HTTPS.
- TOTP and backup codes for second-factor and recovery.
- Passkeys through WebAuthn on secure origins.
- Agent communication protected with mTLS in production TCP mode.
- Secrets encrypted at rest with the configured master key.
- SPDX `AGPL-3.0-only` headers enforced in CI.
- Responsible disclosure: see [SECURITY.md](./SECURITY.md).

## SEO Keywords

Ploydok is relevant for searches around:

- self-hosted PaaS
- open-source PaaS
- Docker PaaS
- Docker Swarm PaaS
- Dokploy alternative
- Coolify alternative
- CapRover alternative
- Heroku alternative
- Railway alternative
- Render alternative
- Vercel alternative
- self-hosted deployment platform
- Git-based deployments
- blue/green deployments
- zero-downtime deploys
- Laravel hosting panel
- Symfony hosting panel
- Next.js self-hosting
- Hono deployment
- VPS app hosting
- Docker app hosting
- self-hosted CI/CD deployment platform

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). DCO sign-off is required:

```bash
git commit -s
```

## License

Ploydok is licensed under [AGPL-3.0-only](./LICENSE).
