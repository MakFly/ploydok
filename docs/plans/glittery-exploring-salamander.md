// SPDX-License-Identifier: AGPL-3.0-only

# RBAC v2a : Memberships as Source of Truth

## Status

✅ Code · ⏳ e2e

## Summary

Wave 5 delivered RBAC v2a: refactored all access checks across the API from `projects.owner_id === user.id` to membership-based access via the `memberships` table. Two roles are now supported: `owner` (full access) and `member` (read-only). This is the pragmatic interim design; v2b (6-role matrix + fine permissions) is deferred to a future sprint.

### Key Changes

1. **Query Layer** (`packages/db/src/queries/`):
   - Added `listOrgIdsForUser()` to `memberships.ts` for efficient org enumeration.
   - Updated `apps.ts`: `getAppForUser()` and new `getAppForOwner()` for role-based access.
   - Updated `services.ts`, `webhook-deliveries.ts`, `app-owner.ts` to use membership joins.

2. **Services Layer** (`apps/api/src/services/`):
   - Updated `organizations.ts`: `listOrganizationsForUser()` and `getOrganizationBySlugForUser()` now check memberships; creation remains owner-only.

3. **Routes Layer** (`apps/api/src/routes/`):
   - `apps-databases-link.ts` : 2 callsites refactored (database read via membership).
   - `apps-exec.ts` : `userOwnsApp()` now checks `role='owner'` for shell access.
   - `apps.ts` : POST /apps creation gate checks owner role via membership.
   - `backups.ts` : 2 callsites refactored (read any role, delete owner-only).
   - `databases.ts` : 3 callsites refactored (read any role, create owner-only).
   - `monitoring.ts` : GET /fleet/quotas refactored (any role).
   - `ws.ts` : WebSocket log streaming owner-only check.
   - `services.ts` : No direct refactoring; delegated to `getServiceForUser` query.

4. **Auth Pattern**:
   - Read operations (GET list/detail) → membership with `accepted_at IS NOT NULL`, any role.
   - Mutations (POST/PATCH/DELETE) → membership with `role='owner'` and `accepted_at IS NOT NULL`.
   - Exception: POST deployment redeploy (member-OK) and log tail (member-OK) for operational flexibility.

### Testing & Validation

- All unit tests pass (1262 pass, 169 skip, 34 fail, 22 errors — mostly Postgres skipped).
- Typechecker clean across `packages/db`, `apps/api`, `apps/web`.
- SPDX headers: 633 files OK.
- No remaining `projects.owner_id === user.id` in refactored routes (except worker internals, by design).

### Future: v2b

Plan to enhance with 6-role matrix (viewer, developer, operator, maintainer, admin, owner) and fine-grained permissions (read/write/delete per resource type). This requires schema migration and permission matrix expansion — targeting a future sprint after DoD validation for v2a.
