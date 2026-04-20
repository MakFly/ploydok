# Sprint 3 — Definition of Done

> Auto-générée par `bun scripts/run-dod.ts`. Dernière mise à jour : 2026-04-20T18:14:46.210Z.

## Résumé

| Statut | Compte |
|---|---|
| ✓ Passé | 0 / 11 |
| ✗ Échoué | 11 / 11 |
| ⊘ Skippé | 0 / 11 |
| Durée totale | 15.4s |

## Items DoD

| # | DoD | Spec | Durée | Statut | Mesure |
|---|---|---|---|---|---|
| #1 | deploy Next.js via Dockerfile | 01-nextjs-docker.spec.ts | 1.5s | ✗ | [chromium] › e2e/dod/01-nextjs-docker.spec.ts:31:3 › DoD #1 — deploy Next.js via Dockerfile › build succeeds and root path returns expected HTML |
| #1b | deploy Next.js via Nixpacks | 02-nextjs-nixpacks.spec.ts | 1.4s | ✗ | — |
| #2 | deploy FastAPI via Nixpacks | 03-fastapi-nixpacks.spec.ts | 1.4s | ✗ | [chromium] › e2e/dod/03-fastapi-nixpacks.spec.ts:32:3 › DoD #2 — deploy FastAPI via Nixpacks › Nixpacks detects Python/FastAPI; build succeeds and endpoints return expected responses |
| #3 | deploy monorepo (root_dir) | 04-monorepo.spec.ts | 1.4s | ✗ | [chromium] › e2e/dod/04-monorepo.spec.ts:31:3 › DoD #3 — deploy monorepo with rootDir + Dockerfile override › build scoped to apps/server/ succeeds and root path returns expected JSON |
| #4 | build cache — t2/t1 < 0.40 | 05-build-cache.spec.ts | 1.4s | ✗ | [chromium] › e2e/dod/05-build-cache.spec.ts:58:3 › DoD #4 — build cache › 2nd build completes in < 40 % of 1st build time |
| #5 | zero-downtime — 0× 5xx during redeploy | 06-zero-downtime.spec.ts | 1.4s | ✗ | [chromium] › e2e/dod/06-zero-downtime.spec.ts:56:3 › DoD #5 — zero-downtime redeploy › 0× 5xx responses during blue-green swap under 60 s load |
| #6 | healthcheck custom | 07-healthcheck-custom.spec.ts | 1.4s | ✗ | [chromium] › e2e/dod/07-healthcheck-custom.spec.ts:62:3 › DoD #6 — healthcheck custom overrides › Test A — permissive healthcheck → deploy succeeds, / returns 200 |
| #7 | logs latency p95 < 500ms | 08-logs-latency.spec.ts | 1.4s | ✗ | [chromium] › e2e/dod/08-logs-latency.spec.ts:65:3 › DoD #7 — logs latency › WS build logs streamed with p95 inter-message latency < 500 ms |
| #8 | rollback < 10s | 09-rollback.spec.ts | 1.4s | ✗ | [chromium] › e2e/dod/09-rollback.spec.ts:58:3 › DoD #8 — rollback < 10s › rollback swaps Caddy back to previous build in < 10 s |
| #9 | builds rootless | 10-rootless-audit.spec.ts | 1.4s | ✗ | [chromium] › e2e/dod/10-rootless-audit.spec.ts:51:3 › DoD #9 — rootless container audit › deployed container does not run as root (USER directive honoured) |
| #10 | cleanup workspace + registry GC | 11-cleanup.spec.ts | 1.4s | ✗ | [chromium] › e2e/dod/11-cleanup.spec.ts:68:3 › DoD #10 — workspace + registry cleanup › build workspace is removed after deploy completes |

## Détails par item

### DoD #1 — deploy Next.js via Dockerfile

- Spec : `apps/web/e2e/dod/01-nextjs-docker.spec.ts`
- Statut : ✗
- Durée : 1.5s
- Mesure : [chromium] › e2e/dod/01-nextjs-docker.spec.ts:31:3 › DoD #1 — deploy Next.js via Dockerfile › build succeeds and root path returns expected HTML
- Stdout (tail) :
  ```
  
         at dod/_harness.ts:111
  
        109 |
        110 |   if (!email || !code) {
      > 111 |     throw new Error(
            |           ^
        112 |       "loginViaApi: E2E_TEST_EMAIL and E2E_TEST_BACKUP_CODE must be set",
        113 |     )
        114 |   }
          at loginViaApi (/home/kev/Documents/lab/brainstorming/mvp-tiers/ploydok/apps/web/e2e/dod/_harness.ts:111:11)
          at /home/kev/Documents/lab/brainstorming/mvp-tiers/ploydok/apps/web/e2e/dod/01-nextjs-docker.spec.ts:22:18
  
      Error Context: test-results/dod-01-nextjs-docker-DoD-1-4ad65--path-returns-expected-HTML-chromium/error-context.md
  
      Error Context: test-results/dod-01-nextjs-docker-DoD-1-4ad65--path-returns-expected-HTML-chromium/error-context.md
  
    1 failed
      [chromium] › e2e/dod/01-nextjs-docker.spec.ts:31:3 › DoD #1 — deploy Next.js via Dockerfile › build succeeds and root path returns expected HTML 
  
  ```

### DoD #1b — deploy Next.js via Nixpacks

- Spec : `apps/web/e2e/dod/02-nextjs-nixpacks.spec.ts`
- Statut : ✗
- Durée : 1.4s
- Stdout (tail) :
  ```
  
         at dod/_harness.ts:111
  
        109 |
        110 |   if (!email || !code) {
      > 111 |     throw new Error(
            |           ^
        112 |       "loginViaApi: E2E_TEST_EMAIL and E2E_TEST_BACKUP_CODE must be set",
        113 |     )
        114 |   }
          at loginViaApi (/home/kev/Documents/lab/brainstorming/mvp-tiers/ploydok/apps/web/e2e/dod/_harness.ts:111:11)
          at /home/kev/Documents/lab/brainstorming/mvp-tiers/ploydok/apps/web/e2e/dod/02-nextjs-nixpacks.spec.ts:23:18
  
      Error Context: test-results/dod-02-nextjs-nixpacks-DoD-3e2fa--path-returns-expected-HTML-chromium/error-context.md
  
      Error Context: test-results/dod-02-nextjs-nixpacks-DoD-3e2fa--path-returns-expected-HTML-chromium/error-context.md
  
    1 failed
      [chromium] › e2e/dod/02-nextjs-nixpacks.spec.ts:32:3 › DoD #1 — deploy Next.js via Nixpacks › Nixpacks auto-detects Next.js; build succeeds and root path returns expected HTML 
  
  ```

### DoD #2 — deploy FastAPI via Nixpacks

- Spec : `apps/web/e2e/dod/03-fastapi-nixpacks.spec.ts`
- Statut : ✗
- Durée : 1.4s
- Mesure : [chromium] › e2e/dod/03-fastapi-nixpacks.spec.ts:32:3 › DoD #2 — deploy FastAPI via Nixpacks › Nixpacks detects Python/FastAPI; build succeeds and endpoints return expected responses
- Stdout (tail) :
  ```
  
         at dod/_harness.ts:111
  
        109 |
        110 |   if (!email || !code) {
      > 111 |     throw new Error(
            |           ^
        112 |       "loginViaApi: E2E_TEST_EMAIL and E2E_TEST_BACKUP_CODE must be set",
        113 |     )
        114 |   }
          at loginViaApi (/home/kev/Documents/lab/brainstorming/mvp-tiers/ploydok/apps/web/e2e/dod/_harness.ts:111:11)
          at /home/kev/Documents/lab/brainstorming/mvp-tiers/ploydok/apps/web/e2e/dod/03-fastapi-nixpacks.spec.ts:23:18
  
      Error Context: test-results/dod-03-fastapi-nixpacks-Do-a383c-s-return-expected-responses-chromium/error-context.md
  
      Error Context: test-results/dod-03-fastapi-nixpacks-Do-a383c-s-return-expected-responses-chromium/error-context.md
  
    1 failed
      [chromium] › e2e/dod/03-fastapi-nixpacks.spec.ts:32:3 › DoD #2 — deploy FastAPI via Nixpacks › Nixpacks detects Python/FastAPI; build succeeds and endpoints return expected responses 
  
  ```

### DoD #3 — deploy monorepo (root_dir)

- Spec : `apps/web/e2e/dod/04-monorepo.spec.ts`
- Statut : ✗
- Durée : 1.4s
- Mesure : [chromium] › e2e/dod/04-monorepo.spec.ts:31:3 › DoD #3 — deploy monorepo with rootDir + Dockerfile override › build scoped to apps/server/ succeeds and root path returns expected JSON
- Stdout (tail) :
  ```
  
         at dod/_harness.ts:111
  
        109 |
        110 |   if (!email || !code) {
      > 111 |     throw new Error(
            |           ^
        112 |       "loginViaApi: E2E_TEST_EMAIL and E2E_TEST_BACKUP_CODE must be set",
        113 |     )
        114 |   }
          at loginViaApi (/home/kev/Documents/lab/brainstorming/mvp-tiers/ploydok/apps/web/e2e/dod/_harness.ts:111:11)
          at /home/kev/Documents/lab/brainstorming/mvp-tiers/ploydok/apps/web/e2e/dod/04-monorepo.spec.ts:22:18
  
      Error Context: test-results/dod-04-monorepo-DoD-3-—-de-9c23f--path-returns-expected-JSON-chromium/error-context.md
  
      Error Context: test-results/dod-04-monorepo-DoD-3-—-de-9c23f--path-returns-expected-JSON-chromium/error-context.md
  
    1 failed
      [chromium] › e2e/dod/04-monorepo.spec.ts:31:3 › DoD #3 — deploy monorepo with rootDir + Dockerfile override › build scoped to apps/server/ succeeds and root path returns expected JSON 
  
  ```

### DoD #4 — build cache — t2/t1 < 0.40

- Spec : `apps/web/e2e/dod/05-build-cache.spec.ts`
- Statut : ✗
- Durée : 1.4s
- Mesure : [chromium] › e2e/dod/05-build-cache.spec.ts:58:3 › DoD #4 — build cache › 2nd build completes in < 40 % of 1st build time
- Stdout (tail) :
  ```
  
         at dod/_harness.ts:111
  
        109 |
        110 |   if (!email || !code) {
      > 111 |     throw new Error(
            |           ^
        112 |       "loginViaApi: E2E_TEST_EMAIL and E2E_TEST_BACKUP_CODE must be set",
        113 |     )
        114 |   }
          at loginViaApi (/home/kev/Documents/lab/brainstorming/mvp-tiers/ploydok/apps/web/e2e/dod/_harness.ts:111:11)
          at /home/kev/Documents/lab/brainstorming/mvp-tiers/ploydok/apps/web/e2e/dod/05-build-cache.spec.ts:47:18
  
      Error Context: test-results/dod-05-build-cache-DoD-4-—-871b1-tes-in-40-of-1st-build-time-chromium/error-context.md
  
      Error Context: test-results/dod-05-build-cache-DoD-4-—-871b1-tes-in-40-of-1st-build-time-chromium/error-context.md
  
    1 failed
      [chromium] › e2e/dod/05-build-cache.spec.ts:58:3 › DoD #4 — build cache › 2nd build completes in < 40 % of 1st build time 
  
  ```

### DoD #5 — zero-downtime — 0× 5xx during redeploy

- Spec : `apps/web/e2e/dod/06-zero-downtime.spec.ts`
- Statut : ✗
- Durée : 1.4s
- Mesure : [chromium] › e2e/dod/06-zero-downtime.spec.ts:56:3 › DoD #5 — zero-downtime redeploy › 0× 5xx responses during blue-green swap under 60 s load
- Stdout (tail) :
  ```
  
         at dod/_harness.ts:111
  
        109 |
        110 |   if (!email || !code) {
      > 111 |     throw new Error(
            |           ^
        112 |       "loginViaApi: E2E_TEST_EMAIL and E2E_TEST_BACKUP_CODE must be set",
        113 |     )
        114 |   }
          at loginViaApi (/home/kev/Documents/lab/brainstorming/mvp-tiers/ploydok/apps/web/e2e/dod/_harness.ts:111:11)
          at /home/kev/Documents/lab/brainstorming/mvp-tiers/ploydok/apps/web/e2e/dod/06-zero-downtime.spec.ts:47:18
  
      Error Context: test-results/dod-06-zero-downtime-DoD-5-f2d6e--green-swap-under-60-s-load-chromium/error-context.md
  
      Error Context: test-results/dod-06-zero-downtime-DoD-5-f2d6e--green-swap-under-60-s-load-chromium/error-context.md
  
    1 failed
      [chromium] › e2e/dod/06-zero-downtime.spec.ts:56:3 › DoD #5 — zero-downtime redeploy › 0× 5xx responses during blue-green swap under 60 s load 
  
  ```

### DoD #6 — healthcheck custom

- Spec : `apps/web/e2e/dod/07-healthcheck-custom.spec.ts`
- Statut : ✗
- Durée : 1.4s
- Mesure : [chromium] › e2e/dod/07-healthcheck-custom.spec.ts:62:3 › DoD #6 — healthcheck custom overrides › Test A — permissive healthcheck → deploy succeeds, / returns 200
- Stdout (tail) :
  ```
         at dod/_harness.ts:111
  
        109 |
        110 |   if (!email || !code) {
      > 111 |     throw new Error(
            |           ^
        112 |       "loginViaApi: E2E_TEST_EMAIL and E2E_TEST_BACKUP_CODE must be set",
        113 |     )
        114 |   }
          at loginViaApi (/home/kev/Documents/lab/brainstorming/mvp-tiers/ploydok/apps/web/e2e/dod/_harness.ts:111:11)
          at /home/kev/Documents/lab/brainstorming/mvp-tiers/ploydok/apps/web/e2e/dod/07-healthcheck-custom.spec.ts:50:18
  
      Error Context: test-results/dod-07-healthcheck-custom--f78c1-deploy-succeeds-returns-200-chromium/error-context.md
  
      Error Context: test-results/dod-07-healthcheck-custom--f78c1-deploy-succeeds-returns-200-chromium/error-context.md
  
    1 failed
      [chromium] › e2e/dod/07-healthcheck-custom.spec.ts:62:3 › DoD #6 — healthcheck custom overrides › Test A — permissive healthcheck → deploy succeeds, / returns 200 
    1 did not run
  
  ```

### DoD #7 — logs latency p95 < 500ms

- Spec : `apps/web/e2e/dod/08-logs-latency.spec.ts`
- Statut : ✗
- Durée : 1.4s
- Mesure : [chromium] › e2e/dod/08-logs-latency.spec.ts:65:3 › DoD #7 — logs latency › WS build logs streamed with p95 inter-message latency < 500 ms
- Stdout (tail) :
  ```
  
         at dod/_harness.ts:111
  
        109 |
        110 |   if (!email || !code) {
      > 111 |     throw new Error(
            |           ^
        112 |       "loginViaApi: E2E_TEST_EMAIL and E2E_TEST_BACKUP_CODE must be set",
        113 |     )
        114 |   }
          at loginViaApi (/home/kev/Documents/lab/brainstorming/mvp-tiers/ploydok/apps/web/e2e/dod/_harness.ts:111:11)
          at /home/kev/Documents/lab/brainstorming/mvp-tiers/ploydok/apps/web/e2e/dod/08-logs-latency.spec.ts:56:18
  
      Error Context: test-results/dod-08-logs-latency-DoD-7--70637-nter-message-latency-500-ms-chromium/error-context.md
  
      Error Context: test-results/dod-08-logs-latency-DoD-7--70637-nter-message-latency-500-ms-chromium/error-context.md
  
    1 failed
      [chromium] › e2e/dod/08-logs-latency.spec.ts:65:3 › DoD #7 — logs latency › WS build logs streamed with p95 inter-message latency < 500 ms 
  
  ```

### DoD #8 — rollback < 10s

- Spec : `apps/web/e2e/dod/09-rollback.spec.ts`
- Statut : ✗
- Durée : 1.4s
- Mesure : [chromium] › e2e/dod/09-rollback.spec.ts:58:3 › DoD #8 — rollback < 10s › rollback swaps Caddy back to previous build in < 10 s
- Stdout (tail) :
  ```
  
         at dod/_harness.ts:111
  
        109 |
        110 |   if (!email || !code) {
      > 111 |     throw new Error(
            |           ^
        112 |       "loginViaApi: E2E_TEST_EMAIL and E2E_TEST_BACKUP_CODE must be set",
        113 |     )
        114 |   }
          at loginViaApi (/home/kev/Documents/lab/brainstorming/mvp-tiers/ploydok/apps/web/e2e/dod/_harness.ts:111:11)
          at /home/kev/Documents/lab/brainstorming/mvp-tiers/ploydok/apps/web/e2e/dod/09-rollback.spec.ts:49:18
  
      Error Context: test-results/dod-09-rollback-DoD-8-—-ro-a50e2-k-to-previous-build-in-10-s-chromium/error-context.md
  
      Error Context: test-results/dod-09-rollback-DoD-8-—-ro-a50e2-k-to-previous-build-in-10-s-chromium/error-context.md
  
    1 failed
      [chromium] › e2e/dod/09-rollback.spec.ts:58:3 › DoD #8 — rollback < 10s › rollback swaps Caddy back to previous build in < 10 s 
  
  ```

### DoD #9 — builds rootless

- Spec : `apps/web/e2e/dod/10-rootless-audit.spec.ts`
- Statut : ✗
- Durée : 1.4s
- Mesure : [chromium] › e2e/dod/10-rootless-audit.spec.ts:51:3 › DoD #9 — rootless container audit › deployed container does not run as root (USER directive honoured)
- Stdout (tail) :
  ```
  
         at dod/_harness.ts:111
  
        109 |
        110 |   if (!email || !code) {
      > 111 |     throw new Error(
            |           ^
        112 |       "loginViaApi: E2E_TEST_EMAIL and E2E_TEST_BACKUP_CODE must be set",
        113 |     )
        114 |   }
          at loginViaApi (/home/kev/Documents/lab/brainstorming/mvp-tiers/ploydok/apps/web/e2e/dod/_harness.ts:111:11)
          at /home/kev/Documents/lab/brainstorming/mvp-tiers/ploydok/apps/web/e2e/dod/10-rootless-audit.spec.ts:42:18
  
      Error Context: test-results/dod-10-rootless-audit-DoD--804af-ot-USER-directive-honoured--chromium/error-context.md
  
      Error Context: test-results/dod-10-rootless-audit-DoD--804af-ot-USER-directive-honoured--chromium/error-context.md
  
    1 failed
      [chromium] › e2e/dod/10-rootless-audit.spec.ts:51:3 › DoD #9 — rootless container audit › deployed container does not run as root (USER directive honoured) 
  
  ```

### DoD #10 — cleanup workspace + registry GC

- Spec : `apps/web/e2e/dod/11-cleanup.spec.ts`
- Statut : ✗
- Durée : 1.4s
- Mesure : [chromium] › e2e/dod/11-cleanup.spec.ts:68:3 › DoD #10 — workspace + registry cleanup › build workspace is removed after deploy completes
- Stdout (tail) :
  ```
         at dod/_harness.ts:111
  
        109 |
        110 |   if (!email || !code) {
      > 111 |     throw new Error(
            |           ^
        112 |       "loginViaApi: E2E_TEST_EMAIL and E2E_TEST_BACKUP_CODE must be set",
        113 |     )
        114 |   }
          at loginViaApi (/home/kev/Documents/lab/brainstorming/mvp-tiers/ploydok/apps/web/e2e/dod/_harness.ts:111:11)
          at /home/kev/Documents/lab/brainstorming/mvp-tiers/ploydok/apps/web/e2e/dod/11-cleanup.spec.ts:57:18
  
      Error Context: test-results/dod-11-cleanup-DoD-10-—-wo-4f87a-oved-after-deploy-completes-chromium/error-context.md
  
      Error Context: test-results/dod-11-cleanup-DoD-10-—-wo-4f87a-oved-after-deploy-completes-chromium/error-context.md
  
    1 failed
      [chromium] › e2e/dod/11-cleanup.spec.ts:68:3 › DoD #10 — workspace + registry cleanup › build workspace is removed after deploy completes 
    2 did not run
  
  ```

## Environnement du run

- Date : 2026-04-20T18:14:46.210Z
- Host : kev (linux 6.12.74+deb13+1-amd64)
- Bun : 1.3.11
- Playwright : Version 1.58.0
- Docker : Docker version 29.4.0, build 9d7ad9f
- Git SHA : ab1d2c60b89c3ea1394464aa561efef7deefe8b7

## Commandes pour reproduire

```bash
make infra-up
make dev-agent
make dev
bun scripts/seed-github-token.ts <userId> <PAT>
PLOYDOK_E2E_REAL=1 bun scripts/run-dod.ts
```
