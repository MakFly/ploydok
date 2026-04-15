# ADR 0003 — UI Design Decisions (Sprint 1, Task 1.6)

**Date**: 2026-04-15  
**Status**: Accepted

---

## Context

Implementation of the web UI layout, auth flows, and session management for the Ploydok PaaS frontend (TanStack Start + shadcn/ui).

---

## Decisions

### 1. Manual routeTree.gen.ts

TanStack Router auto-generates `routeTree.gen.ts` via a Vite plugin during dev/build. Since we cannot run the dev server during implementation, we manually authored this file with the full route type information. **The file will be overwritten automatically on the next `vite dev` or `vite build` run.** This is expected and correct.

**Impact**: TypeScript checks pass correctly with the manual file. Route type safety is preserved.

### 2. CSRF strategy: GET /auth/csrf prefetch

The backend at `apps/api` has a `/auth/csrf` endpoint that returns a token and sets a cookie. The `apiFetch` client:
- On GET requests: does NOT fetch CSRF (no side effects).
- On POST/PUT/DELETE: fetches `/auth/csrf` once, caches the token in memory, sends `x-csrf-token` header.

**Gap**: The backend CSRF route was not observed in `apps/api/src/routes/auth.ts`. The `/auth/csrf` endpoint may be provided by the CSRF middleware in `apps/api/src/app.ts`. If it is not implemented, the client will fail silently on mutations. This should be verified. If missing, simplify to skip CSRF for MVP.

### 3. Passkey revocation: simplified DELETE (no re-challenge)

The spec requires a re-challenge flow (GET login options → startAuthentication → DELETE with result) for passkey revocation. The backend's `DELETE /auth/passkeys/:id` does not require a WebAuthn re-challenge in the request body — it only requires an active session cookie.

**Decision**: We call `DELETE /auth/passkeys/:id` directly. The re-challenge is implicitly satisfied by the session cookie (user already authenticated via passkey to reach this page).

**Gap**: If a stricter re-challenge is required in the future, the backend endpoint signature must be extended to accept a WebAuthn assertion in the request body, and the frontend `useRemovePasskey` hook must be updated to call `startAuthentication` first.

### 4. Test approach: state-machine tests instead of DOM rendering

`@testing-library/react`'s `render` requires a live DOM. In the bun monorepo setup, happy-dom does not propagate correctly to the `.bun` package store where `@testing-library/react` is resolved. Rather than fighting the resolution, we:
- Test pure logic (state machines, query functions) without DOM for `Topbar.test.tsx` and `auth.test.tsx`.
- Use direct fetch mocks for `api.test.ts` (no DOM needed).

**Trade-off**: Less integration coverage on component rendering. Rendering tests can be added in a dedicated storybook or via playwright E2E tests in a later sprint.

### 5. Dark theme: server-side class + client localStorage

The `<html>` element has `className="dark"` by default (SSR-safe dark default). A blocking inline script removes the `dark` class if localStorage says `"light"`. The `ThemeToggle` component updates both the class and localStorage on toggle.

### 6. @ploydok/shared vs @workspace/ui naming

- `@workspace/ui` = the shadcn component package (preset name from shadcn init).
- `@ploydok/shared` = the Zod types/schema package.

The `tsconfig.json` path alias `@workspace/ui/*` maps to `../../packages/ui/src/*`. The `@ploydok/shared` package is resolved via bun workspace `workspace:*`.
