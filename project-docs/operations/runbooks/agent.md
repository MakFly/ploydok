# Runbook — ploydok-agent

## Vue d'ensemble

`ploydok-agent` est le daemon gRPC Rust qui proxifie les opérations Docker
avec enforcement de l'allowlist Ploydok. Il écoute sur un socket Unix et
requiert mTLS par défaut.

---

## Démarrage local

### Prérequis

- Docker daemon actif (`/var/run/docker.sock`)
- Rust + Cargo installés
- Répertoire `/run/ploydok/` créable (ou surcharge via env)

### Build

```bash
cargo build --release -p ploydok-agent --manifest-path agent/Cargo.toml
```

Binaire produit : `agent/target/release/ploydok-agent`

### Démarrage standard (mTLS actif)

```bash
# Répertoires par défaut
sudo mkdir -p /run/ploydok /var/lib/ploydok/pki

# Démarrage
PLOYDOK_AGENT_SOCKET=/run/ploydok/agent.sock \
PLOYDOK_AGENT_PKI_DIR=/var/lib/ploydok/pki \
  ./agent/target/release/ploydok-agent
```

Au premier boot, le daemon génère automatiquement tous les certificats dans
`/var/lib/ploydok/pki/` et affiche leurs fingerprints SHA256 dans les logs.

---

## Certificats mTLS

### Structure générée

```
/var/lib/ploydok/pki/
  ca.pem         CA auto-signée (10 ans)
  ca.key         Clé privée de la CA
  server.pem     Certificat serveur (SAN: localhost, ploydok-agent)
  server.key     Clé privée du serveur
  client.pem     Certificat client (pour apps/api)
  client.key     Clé privée client
```

### Fingerprints au premier boot

Les logs JSON affichent (format `SHA256:xx:yy:zz:...`) :

```json
{"level":"INFO","label":"CA cert","fingerprint":"aa:bb:cc:...","message":"Certificat chargé"}
{"level":"INFO","label":"Server cert","fingerprint":"dd:ee:ff:...","message":"Certificat chargé"}
```

Conserver ces fingerprints pour valider la chaine de confiance côté client.

### Régénération des certificats

Pour forcer la régénération (ex: rotation des clés, compromission) :

```bash
sudo rm -rf /var/lib/ploydok/pki/
sudo systemctl restart ploydok-agent   # ou relancer le binaire manuellement
```

Les nouveaux fingerprints apparaissent dans les logs au redémarrage.

---

## Mode dev / insecure (CI)

**DANGER : ne jamais utiliser en production.**

Si `PLOYDOK_AGENT_INSECURE=1`, le daemon démarre sans mTLS — aucun certificat
n'est généré ou requis. Un warning est loggé :

```
⚠️  mTLS DÉSACTIVÉ (PLOYDOK_AGENT_INSECURE=1) — NE JAMAIS UTILISER EN PRODUCTION
```

Usage typique en CI (voir tâche 2.7) :

```bash
PLOYDOK_AGENT_INSECURE=1 \
PLOYDOK_AGENT_SOCKET=/tmp/ploydok-test.sock \
  ./ploydok-agent &
```

---

## Configuration de l'allowlist

L'agent utilise `StrictValidator` par défaut avec ces paramètres :

| Paramètre            | Défaut                                                          |
|---------------------|-----------------------------------------------------------------|
| `allowed_registries` | `docker.io`, `ghcr.io`, `registry.ploydok.io`                  |
| `volume_prefix`      | `/var/lib/ploydok/volumes`                                      |
| `max_cpu`            | `4.0`                                                           |
| `max_memory_bytes`   | `8589934592` (8 GiB)                                            |

Pour surcharger, créer un fichier JSON ou TOML et pointer `PLOYDOK_VALIDATOR_CONFIG` :

```toml
# /etc/ploydok/validator.toml
allowed_registries = ["docker.io", "ghcr.io", "registry.ploydok.io", "my-registry.example.com"]
volume_prefix = "/var/lib/ploydok/volumes"
max_cpu = 2.0
max_memory_bytes = 4294967296  # 4 GiB
```

```bash
PLOYDOK_VALIDATOR_CONFIG=/etc/ploydok/validator.toml ./ploydok-agent
```

---

## Connexion depuis apps/api (mTLS client)

Pour `apps/api` (TypeScript/gRPC), les certificats client doivent être
accessibles. L'opérateur copie les fichiers depuis `/var/lib/ploydok/pki/`
(ou les monte en volume en dev) :

```typescript
import * as grpc from "@grpc/grpc-js";
import * as fs from "fs";

const caPem       = fs.readFileSync(process.env.PLOYDOK_AGENT_CA!);
const clientCert  = fs.readFileSync(process.env.PLOYDOK_AGENT_CLIENT_CERT!);
const clientKey   = fs.readFileSync(process.env.PLOYDOK_AGENT_CLIENT_KEY!);

const creds = grpc.credentials.createSsl(caPem, clientKey, clientCert);
const agent = new Agent({ credentials: creds });
```

Variables d'environnement attendues par `apps/api` :

| Variable                  | Chemin suggéré                          |
|---------------------------|-----------------------------------------|
| `PLOYDOK_AGENT_CA`        | `/var/lib/ploydok/pki/ca.pem`           |
| `PLOYDOK_AGENT_CLIENT_CERT` | `/var/lib/ploydok/pki/client.pem`     |
| `PLOYDOK_AGENT_CLIENT_KEY`  | `/var/lib/ploydok/pki/client.key`     |

En développement, les trois fichiers sont directement lisibles depuis
`/var/lib/ploydok/pki/` après le premier boot de l'agent.

---

## Logs et debug

Les logs sont en JSON sur stdout (`tracing_subscriber` JSON format).

Filtrage par niveau :

```bash
RUST_LOG=debug ./ploydok-agent 2>&1 | jq .
```

Filtrage par action (ex: refus validator) :

```bash
./ploydok-agent 2>&1 | jq 'select(.rule != null)'
```

Chaque refus du validator émet un log avec les champs :

```json
{
  "level": "WARN",
  "rule": "image_registry_allowlist",
  "detail": "{\"image\":\"evil.io/x\",\"registry\":\"evil.io\"}",
  "message": "validator: accès refusé"
}
```

---

## Intégration systemd (placeholder)

> Un unit systemd sera fourni en Sprint 6 (hardening). En attendant :

```ini
# /etc/systemd/system/ploydok-agent.service  (placeholder)
[Unit]
Description=Ploydok Agent
After=docker.service

[Service]
ExecStart=/usr/local/bin/ploydok-agent
Environment=PLOYDOK_AGENT_SOCKET=/run/ploydok/agent.sock
Environment=PLOYDOK_AGENT_PKI_DIR=/var/lib/ploydok/pki
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Restart manuel :

```bash
sudo systemctl restart ploydok-agent
sudo journalctl -u ploydok-agent -f
```

---

## Note Sprint 6

La redirection des événements d'audit vers la table `audit_log` (DB) est
planifiée pour Sprint 6 (hardening). Actuellement, tous les événements sont
émis sur stdout JSON via `tracing`. Le code est dans
`agent/ploydok-agent/src/audit.rs`.
