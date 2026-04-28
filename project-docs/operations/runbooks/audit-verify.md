# Runbook — Vérifier l'intégrité du journal d'audit

**Sujet** : prouver que `audit_log` n'a pas été altéré depuis l'écriture des entrées.

**Cible** : admin Ploydok, auditeur tiers, enquêteur post-incident.

**Pré-requis** :
- Accès lecture à la base Postgres (`DATABASE_URL`).
- Binaire `ploydok-cli` ≥ Sprint 10 (workspace Rust : `cd agent && cargo build --release -p ploydok-cli`).
- Pubkey Ed25519 de l'instance (récupérable via `GET /instance/audit-pubkey` ou directement depuis `/var/lib/ploydok/keys/audit-ed25519.key.pub` si exposé par l'agent).

---

## Cas d'usage 1 — Vérification de routine

```bash
# Récupérer la pubkey publique
curl -s https://<instance>/instance/audit-pubkey | jq -r .pubkey > /tmp/audit.pubkey.b64

# Vérifier
ploydok-cli audit verify \
  --db-url "$DATABASE_URL" \
  --anchors /var/lib/ploydok/audit/anchors.log \
  --pubkey "$(cat /tmp/audit.pubkey.b64)"
```

**Sortie attendue (succès)** :

```
✓ Loaded 12450 entries, 4 anchors, key kid-2026-04-a1b2c3d4
✓ Hash chain consistent (entries 1..12450)
✓ Signatures verified: 12448 OK, 2 unsigned (warn, not tampered)
✓ Anchors match: latest at id=12440, hash=…ab3f, signed 47min ago
OK
```

**Codes retour** :
- `0` → tout est OK.
- `1` → uniquement des entrées non-signées (legacy). Pas de tampering, mais à investiguer si > 0 sur entrées récentes.
- `2` → `TAMPERED`. **Incident.** Voir cas 3.
- `3` → `ANCHOR_DRIFT`. Le fichier d'ancres ne correspond pas au hash chaîné. **Incident.**
- `4` → erreur IO/DB (DB injoignable, permissions fichier).

---

## Cas d'usage 2 — Pubkey via fichier

Si l'instance est offline et tu as la pubkey depuis un canal hors-bande :

```bash
ploydok-cli audit verify \
  --db-url "$DATABASE_URL" \
  --anchors ./anchors.log \
  --pubkey-file ./audit.pubkey
```

Le fichier pubkey peut contenir 32 bytes raw, hex (64 chars), ou base64url (44 chars). Le CLI auto-détecte.

---

## Cas d'usage 3 — Tampering détecté

Sortie type :

```
✗ TAMPERED at entry 8421: signature mismatch (expected key kid-2026-04-a1b2c3d4)
EXIT 2
```

ou :

```
✗ TAMPERED at entry 8421: chain break (expected prev_hash=…ab3f, got=…cd0e)
EXIT 2
```

**Procédure incident** :

1. **Ne pas redéployer.** Capturer un snapshot DB immédiat : `pg_dump -Fc $DATABASE_URL > audit-incident-$(date +%s).dump`.
2. Récupérer le fichier `anchors.log` côté host agent (read-only via `cat`).
3. Récupérer les logs agent + API depuis l'incident jusqu'à présent.
4. Identifier l'entrée tampered (`audit_log.id = 8421` dans l'exemple).
5. Croiser avec les ancres : la dernière ancre antérieure à l'incident (`signed_at < tamper_time`) est garantie intègre. Tout ce qui est antérieur à cette ancre est trustable.
6. Escalader selon SECURITY.md.

---

## Cas d'usage 4 — CI / monitoring continu

Cron horaire (sur le host admin, pas sur l'instance Ploydok) :

```bash
#!/bin/bash
set -euo pipefail
PUB=$(curl -fs https://instance.example/instance/audit-pubkey | jq -r .pubkey)
if ! ploydok-cli audit verify \
    --db-url "$DATABASE_URL" \
    --anchors /mnt/ploydok-anchors/anchors.log \
    --pubkey "$PUB"; then
  rc=$?
  case $rc in
    1) logger -t ploydok-audit "warn: legacy unsigned entries present (rc=$rc)" ;;
    2) ./alert-incident.sh "ploydok audit TAMPERED" ;;
    3) ./alert-incident.sh "ploydok audit ANCHOR_DRIFT" ;;
    *) ./alert-incident.sh "ploydok audit verify failed rc=$rc" ;;
  esac
fi
```

---

## Limites connues

- **Entrées legacy** (avant Sprint 10) ont `signature=NULL`. Elles sont signalées en warning, pas en tamper. Le marqueur cutoff = première entrée `audit_anchors.head_audit_id`.
- **Mode dégradé** : si l'agent était down au moment d'une entrée, celle-ci a `signature=NULL` (warn, pas tamper). Cf. ADR 0010 § Consequences.
- **Single key** v1.0 : une seule clé active par instance. La rotation arrive sprint 11.
- **Anchor file local** : un attaquant qui compromet le filesystem peut effacer le fichier d'ancres. Mitigation : tail régulier du fichier vers un système externe (S3 immutable, syslog, repo GitHub dédié — voir post-v1 Sigsum).

---

## Voir aussi

- ADR : `project-docs/decisions/0010-audit-log-signed.md`
- Sprint : `project-docs/roadmap/sprint-10-audit-log-signed.md`
- Plan technique : `project-docs/plans/PLAN-sprint-10.md`
- Schema : `packages/db/src/schema/audit-log.ts`
- Signer Rust : `agent/ploydok-agent/src/audit_signer.rs`
- CLI verify : `agent/ploydok-cli/src/audit_verify.rs`
