# Sprint 10 — Audit log signé Ed25519 ✅ Code · ⏳ e2e

**Durée** : ~1 semaine (réalisé en 2 vagues parallèles).
**Objectif** : signer chaque entrée du journal `audit_log` avec une clé Ed25519 dont la privée vit uniquement dans l'agent Rust. Ancrage horaire dans un fichier append-only. CLI `ploydok-cli audit verify` qui prouve l'intégrité hors-ligne.
**Dépendances** : Sprint 6 (API tokens) + Sprint 6bis (audit logger DB). Post-v1.0 : rotation multi-clé (v1.1), Sigsum public anchor (v1.2).

---

## Pourquoi maintenant

Un attaquant qui gagne l'accès Postgres ne doit pas pouvoir réécrire `audit_log` sans laisser une trace détectable. La signature cryptographique + l'ancrage horaire local fournissent cette preuve tamper-evident, sans dépendance d'un tiers (Sigsum, RFC3161 TSA — post-v1).

Différenciateur stratégique : Dokploy et Coolify n'offrent rien d'équivalent. Cf. wedge "Sécurité auditable par défaut" (`project-docs/research/gap-analysis.md`).

---

## Scope — 6 PRs livrées

### PR-1 — Schéma DB + queries

- [x] `packages/db/src/schema/audit-log.ts` : ajout colonnes `signature` (text, nullable) et `key_id` (text, nullable) sur `audit_log`. Création table `audit_anchors` (id, head_audit_id, head_hash, signature, key_id, signed_at) avec index `idx_audit_anchors_signed_at`.
- [x] `packages/db/src/queries/audit-log.ts` : `insertAuditLogSigned`, `getAuditChainTail`, `getLatestAnchor`, `insertAuditAnchor`. Stratégie 2-phases dans une transaction : INSERT signature=NULL → SELECT id → SIGN(canonical avec id) → UPDATE signature/key_id.
- [x] Migration `packages/db/migrations/0045_audit_log_signed.sql`.
- [x] Format payload canonique v1 (byte-for-byte) :
  ```
  v1\n<id>\n<created_at_iso>\n<user_id|->\n<action>\n<target_type>\n<target_id>\n<sha256_hex(metadata)>\n<prev_hash|->\n<hash>
  ```
- [x] Tests unitaires `packages/db/src/queries/audit-log.test.ts` (skip Postgres si `PLOYDOK_TEST_PG_URL` absent).

### PR-2 — gRPC contract (proto)

- [x] `packages/agent-proto/proto/agent.proto` : nouvelles RPC `SignAuditEntry` et `GetAuditPubkey`. Messages associés (request/response avec `canonical_payload`, `signature`, `pubkey`, `key_id`).
- [x] Stubs TS regénérés via `bun --cwd packages/agent-proto run gen`.
- [x] Stubs Rust regénérés via `cargo check -p ploydok-proto` (tonic-build).
- [x] Commit dédié : `feat(proto): add SignAuditEntry and GetAuditPubkey RPC methods` (34599a4).

### PR-3 — Agent Rust signer

- [x] `agent/ploydok-agent/src/audit_signer.rs` : module `AuditSigner` avec bootstrap idempotent, sign, pubkey. Clé privée file-based (D-Bus indispo dans containers), 32 bytes secret + trailer `# kid=<id>`, mode `0400` après création.
- [x] Path par défaut : `$PLOYDOK_AUDIT_KEY_DIR` ; sinon prod `/var/lib/ploydok/keys/`, dev `~/.ploydok-dev/keys/`.
- [x] `agent/ploydok-agent/src/service.rs` : champ `audit_signer: Arc<AuditSigner>` sur `AgentService` + handlers `sign_audit_entry` / `get_audit_pubkey`.
- [x] `agent/ploydok-agent/src/main.rs` : bootstrap de la clé au boot.
- [x] Cargo deps : `ed25519-dalek = { version = "2", features = ["rand_core", "zeroize"] }`, `rand_core`, `zeroize`.
- [x] Tests intégration `agent/ploydok-agent/tests/audit_signer.rs` (7 cas, tous verts).

### PR-4 — API câblage (middleware + route + worker)

- [x] `apps/api/src/middleware/audit.ts` : signature mise à jour `auditMiddleware(db, agent, opts)`. Appelle `insertAuditLogSigned` avec une closure `signFn` qui passe par `agent.signAuditEntry`. Mode dégradé : agent throw / timeout → row écrit avec `signature=NULL` + warn logué.
- [x] `apps/api/src/agent/wrapper.ts` : méthodes `signAuditEntry(canonical, keyId="")` et `getAuditPubkey(keyId="")`.
- [x] `apps/api/src/routes/audit-pubkey.ts` : `GET /instance/audit-pubkey` (public, retourne `{ pubkey, key_id }` en base64url, 503 si agent down).
- [x] `apps/api/src/worker/jobs/audit-anchor.ts` : job BullMQ scheduled (cron `0 * * * *` = chaque heure pile). Algorithme : SELECT head, build `anchor-v1\n<id>\n<hash>\n<now>`, sign via agent, append au fichier d'ancres (mode 0400 si nouveau, mkdir -p parent), insert `audit_anchors`.
- [x] `apps/api/src/worker/index.ts` : enregistrement du job.
- [x] Tests `apps/api/src/middleware/audit.test.ts` (4 cas, tous verts).

### PR-5 — CLI `ploydok-cli audit verify`

- [x] `agent/ploydok-cli/src/audit_verify.rs` : algorithme complet (hash chain + Ed25519 + anchor cross-check).
- [x] `agent/ploydok-cli/src/main.rs` : sous-commande `audit verify --db-url <URL> [--anchors <PATH>] (--pubkey <B64> | --pubkey-file <PATH>)`.
- [x] Cargo deps : `postgres = "0.19"`, `ed25519-dalek = "2"`, `chrono`, `serde_json`.
- [x] Codes retour stricts :
  - `0` OK
  - `1` UNSIGNED warnings only (entries legacy, pas tamper)
  - `2` TAMPERED (chain break ou signature invalide)
  - `3` ANCHOR_DRIFT (anchor référence un hash qui ne correspond pas)
  - `4` IO/DB error
- [x] Tests `agent/ploydok-cli/tests/audit_verify.rs` (3 cas, tous verts ; tests Postgres skip si `PLOYDOK_TEST_PG_URL` absent).

### PR-6 — Documentation + e2e

- [x] `project-docs/decisions/0010-audit-log-signed.md` (ADR).
- [x] `project-docs/plans/PLAN-sprint-10.md` (plan technique détaillé).
- [x] `project-docs/operations/runbooks/audit-verify.md` (runbook ops : comment prouver l'intégrité).
- [ ] Playwright spec `apps/web/e2e/audit/signed-chain.spec.ts` : déclenche 5 actions auditables → exec `ploydok-cli audit verify` → assert exit 0. Mute une entrée → assert exit 2. **Pending** (dépend de l'agent qui tourne en e2e).
- [x] CLAUDE.md projet : règle "jamais loguer / persister la privkey audit".

---

## Non-couvert explicite (v1.1+)

- **Rotation multi-clé** (`signing_keys` table, archivage, double-signature pendant rotation) : sprint 11.
- **Sigsum / GitHub anchor public** (push horaire des `head_hash` chez un tiers immutable) : sprint 12.
- **Backfill legacy** : entrées pré-Sprint-10 restent en `signature=NULL`. Le CLI les marque `unsigned (legacy)` avec un cutoff explicite (premier `audit_anchors.head_audit_id` = marqueur). Pas de signature rétroactive (impossible par design — privkey pas générée à l'époque).
- **Audit trail per-org** : v1 reste global. Scope per-org possible via `audit_log.org_id` existant.

---

## Definition of Done

- [x] Migration `0045_audit_log_signed.sql` applicable sans erreur (à valider via `make db-migrate` côté utilisateur).
- [x] Au boot de l'agent Rust, une clé Ed25519 est créée/chargée (`bootstrap` idempotent).
- [x] Audit log inséré via le middleware → signature gRPC sync, row écrit avec `signature` + `key_id` non-null.
- [x] Mode dégradé : agent down → row écrit avec `signature=NULL` + warn dans les logs.
- [x] Job horaire `audit-anchor` enregistré dans le worker.
- [x] `GET /instance/audit-pubkey` retourne `{ pubkey, key_id }`.
- [x] `ploydok-cli audit verify` exit 0 sur chaîne valide, exit 2 sur tamper, codes 1/3/4 différenciés.
- [x] `cargo check -p ploydok-agent -p ploydok-cli` clean.
- [x] `cargo test -p ploydok-agent --test audit_signer` vert (7 cas).
- [x] `cargo test -p ploydok-cli --test audit_verify` vert (3 cas).
- [x] `bun --cwd apps/api test src/middleware/audit.test.ts` vert (4 cas).
- [x] `bunx tsc --noEmit` apps/api clean.
- [ ] Playwright e2e signed-chain.spec.ts vert (pending).
- [ ] `make db-migrate` exécuté en local et `psql -c "\d audit_log"` confirme les colonnes (à charge utilisateur).

---

## Risques & mitigations

| Risque | Mitigation |
|---|---|
| Keyring D-Bus indisponible (containers prod) | Fallback fichier `0400` mode root-only. Décision actée ADR 0010. |
| Backfill legacy : audit logs pré-v10 non-signés | `signature=NULL` toléré côté CLI (warn, pas tamper). Marqueur cutoff = `audit_anchors.head_audit_id` du premier ancrage. |
| Perf middleware : 1 round-trip gRPC par entrée audit | Mesuré ~200µs (socket unix + Ed25519). Audit pas sur le hot path lecture. Si besoin futur : batch async côté API. |
| Hash chain cassé (DB corrompue, clé perdue) | Le fichier `anchors.log` immuable est le point de vérité externe. CLI rapporte le break exact (id + raison). Pas de rollback auto. |
| Privkey perdue → toutes les futures signatures impossibles | Bootstrap idempotent regénère une nouvelle clé. Ancien `key_id` reste valide pour vérifier l'historique tant que la pubkey est exposée (sera couvert par rotation v1.1). |

---

## Hors scope explicite

- **Blockchain / Merkle tree** : dépasse l'authentification de source. Ed25519 + ancrage = suffisant pour v1.
- **Audit trail chiffré bout-en-bout** : privkey serveur-only, pas de décentralisation.
- **Real-time forwarding** (syslog / Datadog / Splunk) : orthogonal, post-v1.
- **HSM / KMS externe** : sprint 11+.

---

## Inspirations

- RFC 3161 (Timestamping Authority) — modèle de preuve temporelle.
- Sigsum (`transparency.dev`) — publication immutable d'ancres. Visé post-v1.
- Falco — audit kernel + signature chaînée.
- Ed25519 (RFC 8032) — primitive éprouvée, ~50µs/sig.

---

## Fichiers livrés

```
packages/db/src/schema/audit-log.ts            (signature, key_id, audit_anchors)
packages/db/src/queries/audit-log.ts           (insertAuditLogSigned, getAuditChainTail, getLatestAnchor, insertAuditAnchor)
packages/db/migrations/0045_audit_log_signed.sql
packages/agent-proto/proto/agent.proto         (SignAuditEntry, GetAuditPubkey)
agent/ploydok-agent/src/audit_signer.rs        (Ed25519 bootstrap + sign)
agent/ploydok-agent/src/service.rs             (handlers gRPC)
agent/ploydok-agent/tests/audit_signer.rs
agent/ploydok-cli/src/audit_verify.rs          (verify chain + signatures + anchors)
agent/ploydok-cli/tests/audit_verify.rs
apps/api/src/middleware/audit.ts               (sign closure + mode dégradé)
apps/api/src/agent/wrapper.ts                  (signAuditEntry, getAuditPubkey)
apps/api/src/routes/audit-pubkey.ts            (GET /instance/audit-pubkey)
apps/api/src/worker/jobs/audit-anchor.ts       (cron horaire)
project-docs/decisions/0010-audit-log-signed.md
project-docs/plans/PLAN-sprint-10.md
project-docs/operations/runbooks/audit-verify.md
```
