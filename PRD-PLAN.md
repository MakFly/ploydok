# PRD — Production Readiness and Product Completion Plan

## Document control

| Field            | Value                                                     |
| ---------------- | --------------------------------------------------------- |
| Product          | Ploydok                                                   |
| Status           | Execution in progress                                     |
| Date             | 2026-08-18                                                |
| Target           | First production-ready release candidate                  |
| Primary audience | Product, engineering, security and operations             |
| Source of truth  | This document for production-readiness scope and ordering |

This PRD turns the repository audit into a sequenced delivery plan. It defines
what “production-ready” means for Ploydok, which gaps block that state, how the
work is ordered, and which evidence is required before a release can be
promoted.

## Executive decision

Ploydok is currently suitable for controlled development and staging use. It
must not be presented as ready for public production workloads until every
release-blocking requirement in this document is complete.

The product already has a broad control-plane surface, a working web build, a
typed API, a tested Rust agent and local readiness checks. The principal gap is
not the amount of code. It is the absence of enforceable security boundaries,
durable cross-system mutations, recoverable upgrades, immutable releases and
end-to-end proof of the core customer journey.

## Product outcome

A developer or small infrastructure team must be able to install a pinned
Ploydok release on a fresh supported VPS, create the first administrator,
deploy an application from GitHub, GitLab or an OCI image, attach a domain,
operate and recover the workload, upgrade Ploydok, and restore the control
plane without relying on undocumented manual database or Docker operations.

## Goals

1. Close every confirmed host-compromise, tenant-authorization and ingress
   control-plane risk.
2. Make releases immutable, gated, signed, reproducible and promotable by
   digest.
3. Make deploy, cancellation, retry and reconciliation safe under crashes and
   concurrent workers.
4. Prove installation, migration, rollback and restoration on infrastructure
   representative of a fresh VPS.
5. Make the path from first setup to first successful deployment continuous
   and truthful for every advertised source type.
6. Separate the production-readiness milestone from later feature expansion.

## Non-goals for the first production-ready release

- General multi-node Swarm support. The first supported topology is explicitly
  single-node unless the multi-node requirements in the future roadmap are
  completed.
- Bitbucket support.
- WhatsApp notifications.
- A complete Compose-template authoring product.
- High availability of the Ploydok control plane.
- Completing every backend surface that currently has no UI.

These exclusions must be reflected in the README, onboarding and in-product
copy. An excluded feature must not appear as generally available.

## Users and critical journeys

### Instance administrator

Installs and upgrades Ploydok, configures the public origin and Git providers,
monitors platform health, restores the control plane and responds to security
events.

### Workspace owner

Creates applications and databases, manages secrets, domains, backups,
members, integrations and production deployments.

### Workspace member

Observes workspace resources and performs only the operations explicitly
granted by the v1 role model. Members must not mutate owner-only resources or
reveal protected secrets.

### Critical journeys

1. Fresh VPS to completed first-admin setup.
2. Invitation to usable member account.
3. GitHub repository to a healthy public deployment.
4. GitLab repository to a healthy public deployment.
5. OCI image to a healthy public deployment without requiring a Git provider.
6. Failed deployment to a stable previous revision.
7. Ploydok version N to N+1 and back to a compatible N revision.
8. Loss of the original host to restoration on a fresh host.

## Target architecture

```text
╔════════════════════════════ Trusted control plane ═══════════════════════════╗
║                                                                              ║
║ ┌─────────┐ HTTPS/session ┌──────────────────┐ mTLS/gRPC ┌─────────────────┐ ║
║ │ Browser │──────────────▶│ Web/API non-root │──────────▶│ Privileged agent│ ║
║ └─────────┘               └────────┬─────────┘           └────────┬────────┘ ║
║                                    │ admin protocol               │ Docker API║
║                                    ▼                              ▼           ║
║                            ┌────────────────┐             ┌────────────────┐ ║
║                            │ Caddy admin    │             │ Docker/Swarm   │ ║
║                            │ isolated       │             │ single-node    │ ║
║                            └────────────────┘             └────────────────┘ ║
╚══════════════════════════════════════════════════════════════════════════════╝
                                                               ▲
                                                               │ app traffic
╔══════════════════════════ Untrusted workload plane ═══════════╪══════════════╗
║                                                    ┌──────────┴───────────┐ ║
║                                                    │ Customer workloads   │ ║
║                                                    └──────────────────────┘ ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

Legend: arrows are labelled with the protocol or purpose they carry. Double
boxes are trust zones. The API has no Docker socket. Customer workloads can
reach the public ingress but cannot reach its administration interface.

## Release principles

- Fail closed at every authorization and supply-chain boundary.
- Promote an already tested digest; never rebuild during promotion.
- Treat Postgres as the durable source of truth and Redis as replaceable
  delivery infrastructure.
- Fence every external worker side effect with current lease ownership.
- Use expand/contract migrations so application N and N-1 can coexist during
  rollout and rollback.
- A health response is not proof of recoverability. Restore drills and
  authenticated dependency checks are required.
- Product claims describe only tested, reachable user journeys.

## Baseline captured by the audit

The following observations are the starting point for this plan:

- Web production build and monorepo TypeScript checks pass.
- Rust workspace tests pass: 113 tests, 0 failures.
- SPDX check passes for 921 files.
- Installer dry-run scenarios and Compose rendering pass.
- The running local `/health/ready` reports DB, agent, Caddy and ingress as
  healthy.
- Monorepo lint fails in `packages/ui`.
- The web test suite is order-dependent around the DOM test environment.
- Critical Postgres-backed suites are skipped when `PLOYDOK_TEST_PG_URL` is
  absent; multiple suites contain placeholder assertions.
- The real Playwright deploy suites are opt-in and are not release gates.
- The dependency audit reports 113 advisories, including 2 critical and 37
  high advisories before exploitability triage.
- The worktree already contained an unrelated modification to
  `infra/docker-compose.yml`; this PRD does not depend on or alter it.

## Execution tracker

This table records implementation state, not release approval. `Implemented`
still requires the production-path evidence named by the requirement before it
can become `Proven`.

| Requirement | State                                | Current evidence or remaining gate                                                                                  |
| ----------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| SEC-01      | Implemented, runtime proof pending   | Caddy admin uses a Unix socket and isolated management overlay; ephemeral Swarm adversarial test remains            |
| SEC-02      | Implemented, runtime proof pending   | Privileged Docker operations use the validated agent; API/web are non-root and BuildKit is isolated                 |
| SEC-03      | Implemented, DB proof pending        | Owner-only mutation/reveal and masked member metadata tests pass; real Postgres/auth matrix remains                 |
| SEC-04      | Implemented, DB proof pending        | Exact CSRF exemption, signature boundary and durable leased replay guard added                                      |
| SEC-05      | Implemented, production proof pending | Per-file PKI mounts, one-year leaf rotation/revocation and authenticated agent readiness RPC are implemented       |
| SEC-06      | Partial                              | Release workflow generates SBOM/provenance and blocks unfixed critical image findings; full advisory triage remains |
| REL-01      | Implemented, release proof pending   | Signed bootstrap bundle and commit verification workflow added; must be exercised on a real tag                     |
| REL-02      | Implemented, release proof pending   | Candidate digest is scanned/signed then promoted without rebuild; installer and upgrade descriptors resolve digests |
| REL-03      | Partial                              | Quality/installer gates precede image release; PostgreSQL, browser and restore gates are not all consolidated yet   |
| REL-04      | Partial                              | Mutable auto-update is disabled by default and limited to explicit edge; third-party digest pinning remains         |
| OPS-01      | Partial                              | Migration inventory/order CI guard added; N/N-1 compatibility and snapshot upgrade tests remain                     |
| OPS-02      | Partial                              | Encrypted backup/restore automation exists; a release-candidate fresh-host drill remains mandatory                  |
| OPS-03      | Implemented, installer proof pending | README declares single-node and installer refuses an active non-single-node Swarm                                   |
| OPS-04      | Implemented, production proof pending | Authenticated metrics, paging rules, measurable SLOs and runbooks added; real Swarm burn-in remains                 |
| JOB-01..04  | Implemented, runtime proof pending   | Outbox, durable fenced deploy leases, cancellation fencing and resumable creation sagas pass the PostgreSQL/Redis suites; crash and Redis-outage drills remain |
| QUA-01      | Implemented                          | One shared DOM preload removes test-order leakage; the default web suite and typecheck are green                    |
| QUA-02      | Implemented, CI proof pending        | Both isolated gates now run green with zero skips against a real PostgreSQL/Redis pair; a protected CI run remains  |
| QUA-03      | Partial                              | GitLab and restore gates exist; the complete ten-journey protected environment still requires execution            |
| QUA-04      | Partial                              | Third-party fonts removed and indexing disabled; accessibility/browser matrix remains                               |
| PRD-01      | Implemented, re-review pending       | Transactional account acceptance, durable fenced email delivery and browser token lifecycle are implemented          |
| PRD-02      | Implemented                          | OCI source can complete onboarding without a Git provider; targeted tests pass                                      |
| PRD-03      | Implemented, release proof pending   | GitLab OAuth, project/branch selection, exact worker credential binding and browser gate are wired                  |
| PRD-04      | Implemented, browser proof pending   | Onboarding preserves the selected source and continues into application creation/deployment progress                |
| PRD-05      | Implemented                          | README, PRODUCT, onboarding, creation UI, navigation and release notes use Stable/Beta/Planned consistently         |

## Release-blocking requirements

### Epic SEC — Security and trust boundaries

#### SEC-01 — Isolate Caddy administration

**Problem:** Caddy administration is reachable from a network also used by
customer workloads.

**Requirements:**

- Bind the Caddy admin API to a Unix socket shared only with the API, or to a
  dedicated management network that customer workloads cannot join.
- Do not expose the admin port through the public workload network.
- Authenticate the management channel where socket isolation is not possible.

**Acceptance evidence:**

- A test container attached only to `ploydok-public` cannot connect to the
  Caddy admin endpoint.
- The API can still create, update and delete routes.
- The test runs against the rendered production descriptor, not a unit mock.

#### SEC-02 — Remove direct Docker access from the API

**Problem:** the production API mounts the Docker socket and runs as root,
which bypasses the agent validator and makes API compromise equivalent to host
compromise.

**Requirements:**

- Remove `/var/run/docker.sock` from the API service.
- Remove the Docker CLI from the API image unless a documented non-daemon use
  remains.
- Route all Docker operations through the authenticated agent contract.
- Run API and web as explicit non-root users.
- Apply `no-new-privileges`, capability drops, read-only filesystems where
  compatible, and explicit writable mounts.

**Acceptance evidence:**

- Builds, deploys, logs, shell, domains, backups, cleanup and rollback pass
  without a Docker socket or Docker daemon access in the API container.
- An automated assertion proves that the API container cannot execute
  `docker info` or open the host socket.
- Secret files are readable by the runtime UID and not world-readable.

#### SEC-03 — Enforce workspace RBAC for shared environment variables

**Problem:** any accepted member can currently reveal, write and delete shared
environment values that affect all workspace deployments.

**Requirements:**

- Owner role is required for reveal, create, update and delete in v1.
- A member may receive masked metadata only if product policy explicitly
  permits it.
- Cross-workspace identifiers must return a non-disclosing not-found response.
- Second-factor requirements remain in addition to role checks, not instead of
  them.

**Acceptance evidence:**

- Integration tests cover owner, member, unauthenticated, unaccepted member and
  cross-workspace access for every method.
- A member cannot alter the environment of a later deployment.

#### SEC-04 — Permit signed Stripe webhooks without browser CSRF

**Problem:** the global CSRF middleware blocks the external Stripe POST before
signature validation.

**Requirements:**

- Add a path-specific CSRF exemption for the exact Stripe webhook route.
- Preserve raw-body Stripe signature verification.
- Reject missing, invalid, expired and replayed signatures.

**Acceptance evidence:**

- Full-application tests prove valid signed events succeed and unsigned or
  tampered events fail.
- Stripe CLI delivery and retry behavior is verified in a non-production
  environment.

#### SEC-05 — Reduce and rotate PKI exposure

**Requirements:**

- Mount only the certificate and key files required by each service.
- Do not mount the CA private key into normal API or agent runtime containers.
- Define certificate lifetime, rotation, revocation and expiry alerting.
- Readiness must perform an authenticated agent RPC, not only a TCP connect.

#### SEC-06 — Close dependency and image vulnerabilities

**Requirements:**

- Triage every critical and high advisory as runtime, build-time or
  non-exploitable with a documented reason.
- Ship no known exploitable critical runtime advisory.
- Add JS, Rust, container and base-image scans to CI.
- Generate an SBOM for every released image.

### Epic REL — Immutable supply chain and releases

#### REL-01 — Version and authenticate the bootstrap

- The documented production installer must resolve an immutable release, not
  `main` or `edge`.
- Verify the bootstrap archive or commit before executing project-controlled
  code as root.
- Keep `edge` available only through explicit operator opt-in.

#### REL-02 — Promote tested image digests

- Build candidate images once.
- Scan, test and sign their digests.
- Promote those same digests to release tags after all gates pass.
- Deploy `image@sha256:...`; do not verify a mutable tag and pull it in a
  separate resolution step.
- Prevent reuse of an existing semver tag for different content.

#### REL-03 — Create a single gated release workflow

The release workflow must require:

1. SPDX, formatting policy, typecheck and lint.
2. JS/TS and Rust unit tests.
3. Postgres-backed integration tests with no critical skips.
4. Installer and upgrade scenarios.
5. Mandatory browser smoke journeys.
6. Dependency and image scans.
7. SBOM, provenance and signing.
8. Protected approval before stable promotion.

#### REL-04 — Correct automatic updates

- Verify only Ploydok-owned images with the Ploydok signing identity.
- Pin third-party services by digest and update them through an explicit,
  tested dependency process.
- Do not run a five-minute production update timer against a mutable channel.
- Test the exact installed update service end to end.

### Epic OPS — Upgrade, backup and operations

#### OPS-01 — Make migrations compatible with rollback

- Adopt expand/contract as a mandatory migration policy.
- Test application N and N-1 against the expanded schema.
- Prevent destructive contraction until all supported old binaries are gone.
- Test fresh migration and upgrade from at least the oldest supported release
  snapshot.
- Add a CI check for journal ordering, missing migration files and schema
  drift.

#### OPS-02 — Deliver a real disaster-recovery path

- Inventory Postgres, Redis requirements, registry data, Caddy state,
  application volumes, keys, certificates and configuration.
- Back up required durable state outside the original host.
- Encrypt backups, checksum them and define retention.
- Declare target RPO and RTO before the release candidate.
- Restore onto a fresh supported VPS using documented automation.

**Release gate:** a successful restore drill is mandatory. The restored system
must authenticate, list expected resources and serve a previously deployed
application.

#### OPS-03 — Define the supported topology

- State that the first production release supports one Swarm node.
- Refuse or clearly warn when installing into an unsupported multi-node Swarm.
- Do not claim small-fleet or rescheduling guarantees until placement and
  shared-storage requirements are implemented and tested.

#### OPS-04 — Operational observability

- Configure authenticated metrics collection in the production installer.
- Alert on control-plane readiness, disk saturation, deployment failure rate,
  stuck jobs, backup failures, certificate expiry and agent disconnection.
- Define initial SLOs and attach a runbook to every paging alert.
- Keep health, readiness and public status endpoints semantically distinct.

### Epic JOB — Durable deployment orchestration

#### JOB-01 — Transactional outbox

- Commit the requested state change and its outbox event in one Postgres
  transaction.
- Dispatch idempotently to Redis using deterministic job identifiers.
- Reconcile undispatched outbox entries after Redis outage or process crash.

#### JOB-02 — Distributed leases and fencing

- Replace process-local app locks with durable leases.
- Every worker receives a unique ownership token and refreshes a heartbeat.
- Check lease ownership immediately before every Docker, Caddy, registry and
  terminal database side effect.
- A stale worker must not overwrite the result of its successor.

#### JOB-03 — Real cancellation

- Persist cancellation intent.
- Abort cancellable build and deploy operations.
- Prevent new side effects after cancellation or lease loss.
- Reconcile partial Docker, registry and Caddy resources.

#### JOB-04 — Resumable creation sagas

- Represent application and database creation with explicit intermediate
  states.
- An idempotent retry resumes missing steps instead of returning a partially
  initialized resource as complete.
- Provide compensations or reconcilers for orphaned containers, networks,
  routes, volumes and queued jobs.

### Epic QUA — Evidence and release quality

#### QUA-01 — Deterministic baseline

- Resolve all lint errors.
- Remove DOM global leakage and order dependence from web tests.
- Pin CI toolchain versions instead of using floating `latest` where practical.
- Keep the default test command green from a clean checkout.

#### QUA-02 — Real database coverage

- Provision an isolated Postgres database in CI.
- Fail CI if release-critical DB, auth, tenant-isolation or worker suites are
  skipped.
- Replace `expect(true).toBe(true)` placeholder suites with behavioral tests or
  remove the false test claims.

#### QUA-03 — Mandatory end-to-end journeys

At minimum, CI or a protected pre-release environment must execute:

1. Fresh install and first-admin setup.
2. Invite, account switch and acceptance.
3. OCI-image deployment without a Git provider.
4. GitHub deployment and webhook redeploy.
5. GitLab deployment through the actual UI.
6. Domain route and application HTTP readiness.
7. Failed deploy and rollback.
8. Upgrade, migration compatibility and rollback.
9. Backup and fresh-host restore.
10. Workload isolation from Docker and Caddy administration.

Security tests must assert the expected rejection. They must not accept success
responses as an alternative outcome for a test named as an authorization or
second-factor requirement.

#### QUA-04 — Accessibility and browser support

- Run automated accessibility checks on setup, login, onboarding, application
  creation and primary operations.
- Test keyboard-only operation and visible focus.
- Add a mobile viewport plus Firefox and WebKit coverage for critical journeys.
- Use one coherent language per rendered page or introduce real localization.
- Meet WCAG 2.2 AA with no critical or serious automated violation on critical
  journeys.

### Epic PRD — Core product journey

#### PRD-01 — Make invitations usable

Choose and document one model:

- invitation-bound account creation for a recipient without an account; or
- invitations explicitly limited to existing Ploydok accounts.

The recommended model is invitation-bound account creation. The invitation
token must survive sign-out and account switching. Acceptance must verify the
authenticated email against the invited email.

#### PRD-02 — Decouple OCI onboarding from Git

- A user selecting OCI image deployment must not configure GitHub or GitLab.
- Provider onboarding remains required only for provider-backed sources.
- The empty dashboard must expose all supported source types truthfully.

#### PRD-03 — Complete the GitLab browser journey

- Enable the GitLab source tab when the instance and user connection are ready.
- Cover OAuth errors, project search, branch selection, CSRF and application
  creation.
- Do not use a direct test-only `POST /apps` as proof of the UI journey.

#### PRD-04 — Continue onboarding through first deployment

- After account and workspace setup, guide the user to choose a source, create
  an application and observe deployment progress.
- Finish with a healthy application URL or one concrete remediation action.
- Preserve an expert path that skips tutorial copy without skipping required
  configuration.

#### PRD-05 — Publish a truthful feature matrix

Every advertised capability must be classified as:

- stable: reachable and covered by production-path tests;
- beta: reachable, supported with explicit limitations;
- planned: not presented as currently available.

README, PRODUCT, onboarding, navigation and release notes must use the same
classification.

## Feature disposition for the production milestone

| Feature                            | Current audit state                           | Production milestone decision        |
| ---------------------------------- | --------------------------------------------- | ------------------------------------ |
| GitHub deploy                      | Implemented, needs mandatory E2E              | Include                              |
| OCI image deploy                   | Implemented but blocked by onboarding         | Include and fix                      |
| GitLab deploy                      | Backend present, UI disabled                  | Include only after full UI E2E       |
| Domains, logs, shell, env, storage | Present                                       | Include after socket-removal E2E     |
| Managed databases                  | Present                                       | Include after saga and restore proof |
| Rollback                           | Present but migration compatibility unproven  | Include after OPS-01                 |
| Shared env                         | Backend/contract/RBAC inconsistent, UI hidden | Defer or complete securely           |
| Preview deployments                | Partial; PR lifecycle missing                 | Mark beta or defer                   |
| Scheduled jobs                     | Backend ahead of UI                           | Defer UI                             |
| Event webhooks                     | Backend ahead of UI                           | Defer UI                             |
| API tokens                         | Backend ahead of UI                           | Defer UI                             |
| Tags                               | Placeholder                                   | Defer                                |
| Compose templates                  | Model/runtime mismatch                        | Defer and remove current claims      |
| WhatsApp                           | `coming_soon` adapter                         | Defer                                |
| Billing/Stripe                     | Webhook path broken                           | Disable unless SEC-04 is complete    |
| SSO/branding                       | Present with weak behavioral coverage         | Beta until E2E exists                |
| Multi-node Swarm                   | Unsafe stateful placement                     | Explicitly unsupported               |

## Delivery sequence

```text
┌────────────────────┐ security evidence ┌─────────────────────┐
│ Phase 0: Contain   │──────────────────▶│ Phase 1: Release    │
└────────────────────┘                   └──────────┬──────────┘
                                                   │ immutable artifacts
                                                   ▼
┌────────────────────┐ durable jobs      ┌─────────────────────┐
│ Phase 2: Operate   │◀──────────────────│ Phase 3: Orchestrate│
└─────────┬──────────┘                   └─────────────────────┘
          │ restored platform
          ▼
┌────────────────────┐ complete journey  ┌─────────────────────┐
│ Phase 4: Product   │──────────────────▶│ Phase 5: Release RC │
└────────────────────┘                   └─────────────────────┘
```

Legend: arrows identify the evidence passed to the next phase. Phase 2 and
Phase 3 may run partly in parallel, but both must complete before the product
release candidate.

| Phase | Scope                                   |            Estimate | Exit condition                        |
| ----- | --------------------------------------- | ------------------: | ------------------------------------- |
| 0     | SEC-01 through SEC-06                   |  8–12 engineer-days | Host and tenant boundaries proven     |
| 1     | REL-01 through REL-04                   |  6–10 engineer-days | Pinned candidate promoted by digest   |
| 2     | OPS-01 through OPS-04                   |  8–15 engineer-days | Upgrade and fresh-host restore proven |
| 3     | JOB-01 through JOB-04                   | 10–15 engineer-days | Crash/concurrency tests pass          |
| 4     | PRD-01 through PRD-05, QUA requirements |  8–12 engineer-days | Critical journeys pass in browsers    |
| 5     | Release candidate and burn-in           |   5–7 calendar days | No unresolved blocker; SLOs observed  |

The estimates are planning ranges, not commitments. Total expected effort
before public production is approximately 40–64 engineer-days plus burn-in.
Security-boundary refactors and recovery findings can move the upper bound.

## Parallel work lanes

### Lane A — Host and supply-chain security

SEC-01, SEC-02, SEC-05, SEC-06, REL-01 through REL-04.

### Lane B — API durability and data

SEC-03, SEC-04, OPS-01, JOB-01 through JOB-04.

### Lane C — Product and evidence

QUA-01 through QUA-04 and PRD-01 through PRD-05.

The lanes may proceed in parallel after interface decisions are recorded. Lane
C must use the final agent-only Docker contract from Lane A before certifying
deployment journeys.

## Global production gate

The release is Go only when all conditions below are true:

- No open P0 requirement in this document.
- No unaccepted exploitable critical runtime vulnerability.
- API and web run non-root without direct Docker access.
- Workloads cannot reach Caddy administration or host Docker.
- Owner/member/unaccepted/cross-workspace authorization tests pass.
- Default CI is deterministic and green from a clean checkout.
- Release-critical Postgres suites run without skip.
- Images are deployed by verified digest from a gated release.
- Fresh install, upgrade, rollback and fresh-host restore have passed using the
  release candidate artifacts.
- GitHub and OCI critical journeys pass; GitLab is either equally proven or
  clearly excluded from the stable feature set.
- Metrics and paging alerts are active during burn-in.
- README, SECURITY and in-product feature labels match the actual release.

Any failed condition is an automatic No-Go, not a documentation exception.

## Definition of Done for every remediation

1. The requirement and trust boundary are documented.
2. Implementation is narrowly scoped and dead compatibility code is removed.
3. Unit tests cover normal and failure behavior.
4. Integration tests use the real dependency where the risk lies.
5. Tenant and role boundaries have negative tests.
6. Operational logs are useful without leaking secrets.
7. Metrics and alerts exist for silent background failures.
8. Upgrade and rollback implications are reviewed.
9. Documentation and feature classification are updated.
10. The relevant production-path acceptance evidence is attached to delivery.

## Risks and decisions still required

| Decision                                            | Why it matters                                        | Required before                |
| --------------------------------------------------- | ----------------------------------------------------- | ------------------------------ |
| Invitation creates account vs existing-account only | Determines identity UX and security model             | PRD-01 implementation          |
| Stable GitLab in first release vs beta/deferred     | Changes mandatory browser matrix                      | Release-candidate scope freeze |
| Shared env completed vs hidden                      | Backend currently creates security and contract debt  | SEC-03 closure                 |
| Initial RPO and RTO                                 | Determines backup architecture and restore automation | OPS-02 design approval         |
| Supported Debian/Ubuntu versions and architectures  | Defines installer and image test matrix               | REL-03 implementation          |
| SLO targets and alert recipient                     | Required to evaluate burn-in                          | OPS-04 completion              |

## Post-production feature roadmap

This roadmap begins only after the global production gate passes.

### Iteration A — Existing backend surfaces

1. Shared environment UI, if not completed for the production milestone.
2. Scheduled jobs UI and execution history.
3. Outbound event webhooks UI, delivery history and replay.
4. API token UI, scope editor, rotation and revocation.

### Iteration B — Deployment depth

1. Pull-request preview lifecycle, wildcard routing and garbage collection.
2. Compose deployment support with an explicit runtime contract.
3. Cross-resource tags and filtering.
4. Versioned reusable templates.

### Iteration C — Ecosystem breadth

1. Slack adapter completion.
2. WhatsApp adapter.
3. Bitbucket provider.
4. Additional backup destinations and restore policies.

### Iteration D — Multi-node

Multi-node becomes eligible only with placement constraints, replicated or
shared durable storage, node-loss tests, agent identity per node, scheduling
semantics and documented failure recovery.

## Audit traceability

Primary implementation areas identified by the audit:

- Caddy and production networks: `installer/templates/Caddyfile`,
  `installer/templates/docker-stack.yml`.
- API container boundary: `apps/api/Dockerfile`.
- Shared environment authorization: `apps/api/src/routes/project-env.ts`,
  `packages/db/src/queries/project-env.ts`, `apps/api/src/secrets/resolver.ts`.
- CSRF and Stripe: `apps/api/src/app.ts`,
  `apps/api/src/routes/webhooks-stripe.ts`.
- Deployment durability: `apps/api/src/worker/queue-enqueue.ts`,
  `apps/api/src/worker/app-deploy-lock.ts`,
  `apps/api/src/worker/handlers/deploy.ts`.
- Installer and release: `installer/bootstrap.sh`, `installer/install.sh`,
  `installer/ploydok-cli`, `.github/workflows/release-images.yml`.
- Product journey: `apps/web/src/lib/auth-guards.ts`,
  `apps/web/src/routes/onboarding.tsx`,
  `apps/web/src/components/apps/CreateAppModal.tsx`,
  `apps/web/src/routes/_public/invitations/accept.tsx`.
- Test gates: `.github/workflows/ci.yml`,
  `.github/workflows/ci-integration.yml`, `apps/web/e2e`,
  `packages/db/src` and `apps/api/src`.

## Repository Markdown inventory

The inventory was reconciled on 2026-08-18 from tracked and untracked Git
files. It excludes dependencies and Git internals (`node_modules/**` and
`.git/**`). The obsolete `packages/ui/DESIGN.md` was removed; `PRODUCT.md` is
the product and design-context source of truth. The repository now contains 31
active Markdown files:

- 12 agent rule files: `AGENTS.md`, `CLAUDE.md` and the 10 files under
  `.claude/rules/`;
- 4 GitHub contribution templates under `.github/`;
- 7 project-level documents: `README.md`, `PRODUCT.md`, `PRD-PLAN.md`,
  `OPERATIONS.md`, `SECURITY.md`, `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md`;
- 4 product changelog entries under `apps/web/src/content/changelog/`;
- 3 subsystem documents: `agent/ploydok-agent/README.md`,
  `packages/agent-proto/README.md` and `packages/app-auditor/README.md`;
- `infra/README.md`.

The canonical machine-verifiable inventory command is:

```bash
{ git ls-files '*.md'; git ls-files --others --exclude-standard '*.md'; } \
  | sort -u
```
