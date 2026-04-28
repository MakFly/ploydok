# ADR 0010 — Audit log signé Ed25519 + ancrage horaire local

**Date** : 2026-04-28
**Status** : Accepted (sprint 10)

---

## Context

Le sprint 6bis a instauré un journal d'audit (`audit_log`) pour tracer les mutations système (create app, rotate secret, delete user, etc.). Aujourd'hui, un attaquant avec accès base de données peut modifier ou supprimer des entrées après-coup sans laisser de trace : il n'y a aucune preuve d'intégrité.

L'audit légal / conformité demande une garantie : **les entrées du journal d'audit ne peuvent pas être altérées sans détection**.

Trois approches existent sur le marché :

1. **Ed25519 localement + ancrage horaire local** (léger, rapide) — ce qu'on choisit.
2. **RFC 3161 Timestamping Authority** (externe, lourd) — post-v1.
3. **Sigsum / Transparency log public** (blockchain-like, très lourd) — post-v1.2.

Pour v1.0, on choisit l'approche 1 : signature avec clé privée système, vérification en local, preuve immutable sur disque.

---

## Decision

### 1. Signer chaque audit log entrée avec Ed25519

- Clé privée système : générée au boot, stockée dans l'OS keyring (Linux `secretservice`, macOS keychain, fallback fichier `~/.ploydok-dev/signing.key`).
- Signature **asynchrone** : job BullMQ horaire qui signe les entrées non-signées en batch. Zéro impact request-path.
- Signature incluse dans table `audit_log_signatures` (FK audit_log.id).

### 2. Payload canonique v1 (byte-for-byte)

Format immuable et machine-parseable pour éviter ambiguïtés :

```
v1
<audit_id>
<created_at_iso8601>
<user_id|-→
<action>
<target_type>
<target_id>
<sha256_hex(metadata)>
<prev_hash|->
<hash>
```

Exemple :
```
v1
01ARZ3NDEKTSV4RRFFQ69G5FAV
2026-04-28T14:32:15.123456Z
user_abc123
app.created
app
app_xyz
42a5f1b42c6f3a8d7c1e9f2a4b5c6d7e
41a5f1b42c6f3a8d7c1e9f2a4b5c6d7d
42b6f1b42c6f3a8d7c1e9f2a4b5c6d7f
```

Hash-enchaîné : chaque signature inclut le hash de la précédente (détecte insertion/suppression d'entrées).

### 3. Ancrage horaire local immutable

Fichier append-only (`/var/lib/ploydok/audit/anchors.log` en prod, `~/.ploydok-dev/audit/anchors.log` en dev) :

```
2026-04-28T15:00:01.123456Z|41a5f1b42c6f3a8d7c1e9f2a4b5c6d7d|42b6f1b42c6f3a8d7c1e9f2a4b5c6d7f|5|5
2026-04-28T16:00:02.234567Z|42b6f1b42c6f3a8d7c1e9f2a4b5c6d7f|43c6f1b42c6f3a8d7c1e9f2a4b5c6d80|3|3
```

Champs : `<timestamp_iso>|<prev_hash>|<last_hash>|<entry_count>|<signature_count>`

Permissions : `0400` (lecture root only) en prod, `0600` (user only) en dev.

**Immuable** : append-only, pas de suppression/troncature. Tout le drift de la BD est reconstructible par replay depuis ce fichier.

### 4. API de vérification (admin-only)

`POST /admin/audit/verify` qui :

- Sélectionne entries dans une plage `[from_id, to_id]`.
- Rejoue chaque signature et hash-chain.
- Retourne `{ valid: boolean; first_chain_break?: { at: id; reason: string } }`.

Si une signature est invalide ou un lien cassé : localisation **exacte** du tampering.

### 5. Mode dégradé (agent/keyring down)

Si la clé privée est inaccessible (keyring mort, fichier perdu) :

- Signature passée à `NULL`.
- Entrée insérée quand même dans `audit_log`.
- Log warning : `"Audit signature skipped: keyring unreachable"`.
- Pas de blocage request-path.
- L'admin est alerté et peut remedier avant la prochaine rotation (v1.1).

### 6. Rotation de clé multi (post-v1.0)

v1.0 = **une seule clé active**. v1.1 ajoutera :

- Pré-génération de clés futures.
- Archivage des anciennes clés.
- Historique de qui a signé quoi (user_id optionnel dans `audit_log_signatures`).

### 7. Sigsum public anchor (post-v1.2)

v1.2 ajoutera un mécanisme optionnel de publication des hashes vers un registre transparent (Sigsum, Rekor, ou équivalent). Aujourd'hui : c'est trop lourd.

---

## Alternatives Rejected

### A. RFC 3161 Timestamping Authority (TSA)

**Avantage** : tiers de confiance certifie la timestamp, preuve légale plus forte.

**Inconvénient** :
- Dépendance d'un service externe.
- Latence réseau (POST à un TSA à chaque signature).
- Coût (services TSA non gratuits).
- Configuration cert client requise.

**Verdict** : Trop lourd pour v1.0. Peut être ajouté comme option opt-in v1.1.

### B. Sigsum complet (transparency.dev)

**Avantage** : Log immuable public, impossible d'y introduire du faux.

**Inconvénient** :
- Nécessite un serveur Sigsum dédié en prod.
- Sync réseau obligatoire.
- Complexité API (clutter checker, monitor, witness).
- L'auto-hoste ne veut généralement pas publier son audit log.

**Verdict** : Excellent pour les SaaS multi-tenant. Pour un auto-hôte privé, surdinGinensionné. Listé pour v1.2 si demandé.

### C. Hash-only, pas de signature

**Avantage** : léger, rapide.

**Inconvénient** : ne prouve rien. Un attaquant peut recalculer le hash après modification. Nécessite une clé asymétrique pour valider l'origine.

**Verdict** : Crypto débile. Rejeté.

### D. Chiffrement symmétrique (AES-GCM) + MAC

**Avantage** : plus rapide qu'asymétrique, AEAD.

**Inconvénient** :
- La clé symétrique doit être stockée quelque part — même problème que la clé privée.
- Pas de preuve d'identité (qui a signé ?). Avec Ed25519, on peut prouver "cette clé a signé ça".

**Verdict** : Ed25519 répond mieux à la question "did this change" + "who did it".

---

## Consequences

### Positive

- ✅ Preuve d'intégrité : tampering immédiatement détectable.
- ✅ Zéro dépendance réseau pour la signature.
- ✅ Zéro impact perfs request-path (async worker).
- ✅ Immuable sur disque (append-only).
- ✅ Footprint petit (~64 bytes/signature).
- ✅ Compatible future (v1.1 peut ajouter rotation, v1.2 peut ajouter Sigsum).

### Negative

- ⚠️ Keyring indisponible en container = fallback fichier (perte de OS-level protection).
- ⚠️ Backfill v10 : audit logs pré-existants sans signature nécessitent un batch job post-migration.
- ⚠️ Perf worker : ~5-10ms/signature en Rust, 100-200ms/signature en JS (mais batch + async = acceptable).
- ⚠️ Clé perdue = audit logs non-vérifiables (donc backup + rotation clés obligatoires v1.1).

### Operational

- Clé privée doit être backupée avec la DB.
- Rotation de clé (v1.1) : snapshot DB, generate new key, re-sign historic entries.
- Monitoring : alert si audit-sign job échoue (keyring dead).
- Troubleshooting guide : keyring unavailable → use fallback file.

---

## Inspirations + Références

- **Ed25519 (RFC 8032)** : 64-byte signature, 32-byte key, simple, fast, industry standard.
- **Falco audit trail** (`falcosecurity.org`): modèle de signature chainée pour audit kernel.
- **RFC 3161** (TSA) : référence pour la timestamp, trop lourd pour v1.
- **Sigsum** (`transparency.dev`) : référence pour la publication immutable, post-v1.
- **OWASP Logging Cheat Sheet** : signature + immutable audit as best practice.

---

## Migration Path (v1.0 → v1.1 → v1.2)

| Version | Feature | Comment |
|---------|---------|---------|
| v1.0 | Ed25519 local + hourly anchor | Minimal, local-only, preuve d'intégrité |
| v1.1 | Key rotation + multi-key history | Archiv anciennes clés, préparer v1.2 |
| v1.2 | Sigsum public anchor (opt-in) | Publish hashes to transparent log |
| v1.3+ | RFC 3161 TSA (opt-in) | External timestamp + legal proof |
