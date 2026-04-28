# ADR 0002 — Auth backend design decisions (Sprint 1.5a)

**Status**: Accepted  
**Date**: 2026-04-15  
**Author**: Claude (task 1.5a)

---

## Context

Sprint 1.5a implements the passkey-based authentication backend for Ploydok. Several non-trivial design decisions were made.

---

## Decisions

### 1. bcryptjs instead of argon2

**Decision**: Use `bcryptjs` (pure-JS bcrypt) for hashing backup codes and refresh token hashes.

**Rationale**:
- `argon2` requires native bindings (Node addons) that complicate CI on Linux environments (same issue already encountered with `keytar`).
- `bcryptjs` is pure JavaScript, zero native dependencies, and runs identically in Bun.
- Work factor 10 is acceptable for backup codes (low-frequency operation).
- For v2, argon2id may be considered once native build pipeline is stabilised.

---

### 2. WebAuthn challenge storage: in-memory Map with TTL

**Decision**: Challenges are stored in a process-local `Map<string, {challenge, expiresAt}>` with a 5-minute TTL and a 60-second cleanup interval.

**Rationale**:
- v1 targets single-server deployment (Ploydok is self-hosted PaaS).
- Avoids a Redis/Valkey dependency in sprint 1.
- The cleanup interval uses `.unref()` so it does not prevent clean process exit.

**Risk**: Multi-replica deployments (horizontal scale) will lose challenges across nodes. A DB table or Redis store is required at that point.

**Migration path**: Replace `apps/api/src/auth/challenges.ts` with a DB-backed implementation in sprint 5 or when horizontal scaling is needed.

---

### 3. Backup codes format: TXT download instead of PDF

**Decision**: `POST /auth/backup-codes/generate` returns a `.txt` file attachment instead of a PDF.

**Rationale**:
- `pdfkit` adds ~3 MB to the bundle and requires complex stream handling in Bun.
- Backup code downloads are infrequent (once per account setup).
- Plain text is universally readable and printable.
- The format is `XXXX-XXXX-XXXX` (base32 chars A-Z2-7), human-typeable without ambiguity.

**Migration path**: If PDF is required (e.g. for accessibility or compliance), add `pdfkit` in a future sprint and wrap the text in a simple single-page PDF.

---

### 4. Refresh token format: `sessionId:rawToken` cookie

**Decision**: The `ploydok_refresh` cookie value encodes both the session ID and the raw token as `{sessionId}:{base64url-64bytes}`.

**Rationale**:
- Avoids an extra DB lookup (no need to store session ID separately or scan all sessions for a matching hash).
- The server splits on the first `:` to extract the session ID, then bcrypt-compares the raw token against the stored hash.

---

### 5. E2E WebAuthn test: skipped in v1

**Decision**: `auth.e2e.test.ts` has a `test.skip` for the full register → login flow.

**Rationale**:
- `@simplewebauthn/server` verifies real CBOR-encoded attestation and assertion responses. Generating these requires a WebAuthn virtual authenticator (browser API or native library).
- No lightweight Bun-compatible virtual authenticator was found that doesn't require a browser or complex native code.
- The unit tests for JWT, sessions, backup codes, and middleware provide adequate coverage for sprint 1.

**Migration path**: Sprint 6 integration tests will use a software authenticator (e.g. `virtual-authenticator` package or Playwright with Chrome DevTools Protocol).
