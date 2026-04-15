# ploydok-agent

Daemon Rust qui expose une API gRPC (tonic) sur un Unix socket et délègue
toutes les opérations Docker à bollard. Aucun accès direct au socket Docker
depuis `apps/api` — tout transite par cet agent.

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
PLOYDOK_AGENT_SOCKET=/tmp/agent.sock ./agent/target/release/ploydok-agent

# Niveau de log
RUST_LOG=debug PLOYDOK_AGENT_SOCKET=/tmp/agent.sock ./agent/target/release/ploydok-agent
```

## Prérequis

- Docker accessible via socket (défaut : `/var/run/docker.sock`).
- Surcharger via `DOCKER_HOST` si besoin : `DOCKER_HOST=unix:///var/run/docker.sock`.
- L'utilisateur lançant le daemon doit avoir accès au socket Docker (`docker` group ou root).

## Configuration

| Variable               | Défaut                       | Description                  |
|------------------------|------------------------------|------------------------------|
| `PLOYDOK_AGENT_SOCKET` | `/run/ploydok/agent.sock`    | Chemin du Unix socket gRPC   |
| `DOCKER_HOST`          | `/var/run/docker.sock`       | Socket Docker daemon         |
| `RUST_LOG`             | `info`                       | Niveau de log (format JSON)  |

## Architecture

```
apps/api  ──gRPC/unix──►  ploydok-agent  ──bollard──►  Docker daemon
                          ├── validator  (task 2.3: StrictValidator)
                          ├── audit      (task 2.4: → audit_log DB)
                          └── service    (10 RPCs)
```

## Sécurité (task 2.3)

Le `PermissiveValidator` actuel autorise tout. Task 2.3 le remplace par
`StrictValidator` qui applique :

- Noms containers/networks préfixés `ploydok-`
- Images depuis registries whitelist
- Bind-mounts limités à `/var/lib/ploydok/volumes/`
- Refus `privileged`, `pid=host`, `cap-add` non whitelistés
- mTLS sur le Unix socket
