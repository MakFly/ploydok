# ploydok-agent

Daemon Rust qui expose une API gRPC avec tonic et délègue les opérations Docker
à bollard. Le mode local utilise un socket Unix. Le descriptor de production
utilise un canal TCP protégé par mTLS.

L'architecture cible impose que `apps/api` n'accède jamais directement au
socket Docker : toutes les opérations privilégiées doivent transiter par cet
agent. Tant que le descriptor de production conserve un accès Docker direct
pour l'API, cette frontière de sécurité n'est pas considérée comme satisfaite.

## Build

```bash
# Dev
cargo build -p ploydok-agent --manifest-path agent/Cargo.toml

# Release
cargo build --release -p ploydok-agent --manifest-path agent/Cargo.toml
```

## Lancement

```bash
# Utilise /run/ploydok/agent.sock par défaut (créé automatiquement)
./agent/target/release/ploydok-agent

# Socket personnalisé
PLOYDOK_AGENT_SOCKET=/tmp/ploydok/agent.sock ./agent/target/release/ploydok-agent

# Niveau de log
RUST_LOG=debug PLOYDOK_AGENT_SOCKET=/tmp/ploydok/agent.sock ./agent/target/release/ploydok-agent
```

## Prérequis

- Docker accessible via socket (défaut : `/var/run/docker.sock`).
- Surcharger via `DOCKER_HOST` si besoin : `DOCKER_HOST=unix:///var/run/docker.sock`.
- L'utilisateur lançant le daemon doit avoir accès au socket Docker (`docker` group ou root).

## Configuration

| Variable               | Défaut                       | Description                  |
|------------------------|------------------------------|------------------------------|
| Variable | Défaut | Description |
| --- | --- | --- |
| `PLOYDOK_AGENT_SOCKET` | `/run/ploydok/agent.sock` | Chemin du socket Unix gRPC en mode local |
| `PLOYDOK_AGENT_ADDR` | non défini | Adresse TCP gRPC utilisée avec la configuration TLS de production |
| `DOCKER_HOST` | `/var/run/docker.sock` | Endpoint du daemon Docker utilisé par l'agent |
| `PLOYDOK_VALIDATOR_CONFIG` | configuration embarquée | Politique d'autorisation des opérations agent |
| `RUST_LOG` | `info` | Niveau de log structuré |

## Architecture

```text
apps/api  ──gRPC Unix ou mTLS──▶  ploydok-agent  ──bollard──▶  Docker daemon
                                  ├── StrictValidator
                                  ├── journal d'audit
                                  └── services gRPC
```

## Sécurité

Le démarrage normal charge `StrictValidator`, qui applique notamment :

- Noms containers/networks préfixés `ploydok-`
- Images depuis registries whitelist
- Bind-mounts limités à `/var/lib/ploydok/volumes/` et `/var/lib/ploydok/app-volumes/`
- Refus `privileged`, `pid=host`, `cap-add` non whitelistés
- mTLS lorsque l'agent écoute sur TCP en production
