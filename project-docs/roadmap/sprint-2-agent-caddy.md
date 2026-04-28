# Sprint 2 — Agent Rust + Caddy ✅ Terminé

> **Statut : TERMINÉ** — audit 2026-04-20. Tous les items DoD vérifiés dans le code.
> Audit log tracé sur chaque RPC (`agent/ploydok-agent/src/service.rs`).
> Non-bloquant : valider binaire release < 15 MB en CI.

**Durée** : 1 semaine
**Objectif** : isoler tout accès à Docker dans un daemon Rust sécurisé et piloter Caddy via admin API.
**Dépendances** : Sprint 1 terminé.

---

## Scope

Le socket Docker ne doit JAMAIS être accessible directement par `apps/api`. Tout passe par `ploydok-agent`, un daemon Rust qui expose une API gRPC avec allowlist stricte d'actions. Caddy est piloté via son admin API `:2019` pour router le trafic.

---

## Tâches détaillées

### 2.1 Crate `agent/`
- `cargo new --bin agent`
- Deps : `tonic` (gRPC), `bollard` (Docker), `tokio`, `tracing`, `serde`, `rustls`
- Workspace membre du monorepo (doc `README.md` pour builder avec `cargo build --release`)

### 2.2 Proto gRPC
Dans `packages/agent-proto/` :
```proto
service Agent {
  rpc ContainerCreate(...) returns (...);
  rpc ContainerStart(...) returns (...);
  rpc ContainerStop(...) returns (...);
  rpc ContainerRemove(...) returns (...);
  rpc ContainerLogs(...) returns (stream LogLine);
  rpc ContainerStats(...) returns (stream StatsFrame);
  rpc ImagePull(...) returns (stream PullProgress);
  rpc ImageBuild(...) returns (stream BuildProgress);
  rpc NetworkCreate(...) returns (...);
  rpc NetworkRemove(...) returns (...);
}
```
- Génération TS via `protoc` + `ts-proto` dans `packages/agent-proto`
- Génération Rust via `tonic-build`

### 2.3 Allowlist & sécu agent
- Chaque RPC valide : nom container préfixé `ploydok-*`, image dans registry allowlistée, pas de `--privileged`, pas de bind-mount hors `/var/lib/ploydok/volumes`
- Refus explicite : `host network`, `pid=host`, `cap-add` non whitelistés
- mTLS entre `apps/api` et `agent` via unix socket `/run/ploydok/agent.sock` + certs auto-générés au premier boot
- Logs structurés (JSON) tracés dans `audit_log`

### 2.4 Client TS dans `apps/api`
- Wrapper `AgentClient` qui mappe les RPC
- Reconnection auto, timeout 30s par défaut
- Tests mocks via `@grpc/grpc-js` server fake

### 2.5 Caddy
- Image `caddy:2-alpine` lancée au boot via `docker compose` d'infra
- Admin API exposée sur `localhost:2019` uniquement
- Module TS `caddy-client.ts` dans `apps/api` :
  - `upsertRoute({ host, upstream, app_id })`
  - `removeRoute(app_id)`
  - `getConfig()`
- TLS auto Let's Encrypt (ACME)

### 2.6 Endpoint debug
- `POST /debug/spawn-nginx` (protégé par rôle owner) :
  - agent → `ContainerCreate` + `ContainerStart` nginx
  - caddy-client → `upsertRoute` vers sous-domaine auto
  - retourne URL live
- `DELETE /debug/spawn-nginx/:id` pour cleanup

### 2.7 Tests d'intégration
- Docker-in-Docker dans CI (ou runner self-hosted)
- Scénario : spawn nginx → HTTP 200 sur sous-domaine → cleanup → plus de route Caddy

---

## Deliverable démo

1. `apps/api` démarre, se connecte à l'agent via unix socket mTLS
2. Appel `POST /debug/spawn-nginx` depuis Postman
3. Curl sur l'URL retournée → « Welcome to nginx »
4. Audit log montre les 5 actions exécutées (container create/start, network, caddy route, TLS issue)

---

## Definition of Done

- [ ] Agent compile en release, binaire < 15 MB
- [ ] Tests allowlist : 10 tentatives d'actions interdites → 10 refus
- [ ] mTLS actif, impossible de contacter l'agent sans cert
- [ ] Caddy admin API non exposée publiquement (bind `127.0.0.1`)
- [ ] Test e2e `spawn-nginx` vert en CI
- [ ] Audit log tracé pour chaque RPC
- [ ] Doc `docs/runbooks/agent.md` : comment debug, restart, renouveler certs

---

## Risques sprint

| Risque | Mitigation |
|---|---|
| DinD fragile en CI | Runner self-hosted sur VM dédiée si nécessaire |
| Bollard API versioning Docker | Pinner version Docker API, tester sur Docker 24+ |
| Certs mTLS auto-générés → rotation ? | Doc rotation manuelle v1, auto v1.5 |
