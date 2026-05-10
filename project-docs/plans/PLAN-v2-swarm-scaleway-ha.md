# PLAN — v2 Swarm + Scaleway HA

> Plan produit/technique pour une v2 "High Availability".
> Écrit le 2026-05-10.
> Objectif : faire évoluer Ploydok d'un runtime Docker single-node vers un mode HA optionnel basé sur Docker Swarm, Caddy global et Scaleway Load Balancer managé, sans casser le mode v1.

---

## Décisions verrouillées

- [x] Le runtime actuel `docker` reste le défaut et continue de servir les installations single-VPS.
- [x] Le runtime `swarm` est optionnel, activé par cluster et par app.
- [x] Ploydok v2.0 ne crée pas les Instances Scaleway : les nodes existent déjà.
- [x] Ploydok provisionne et synchronise le Scaleway Load Balancer.
- [x] Caddy tourne en service Swarm `global` sur tous les nodes ingress.
- [x] La haute disponibilité couvre aussi la plateforme Ploydok : web, API, workers, schedulers et ingress.
- [x] HA mode exige Postgres, Redis/Valkey et registry OCI en dépendances HA externes.

---

## Pourquoi

Le modèle actuel est excellent pour un VPS unique :

- container Docker unitaire par app ;
- blue/green contrôlé par Ploydok ;
- Caddy pointe vers un container précis ;
- Postgres, Redis, registry, Caddy et agent vivent localement ;
- locks et bus temps réel sont encore majoritairement process-local.

Ce modèle ne suffit pas pour :

- plusieurs VPS derrière un Scaleway Load Balancer ;
- replicas applicatifs horizontaux ;
- drain/maintenance d'un node sans coupure ;
- résilience de Ploydok lui-même ;
- provisioning/sync d'un load balancer provider.

La v2 HA doit donc ajouter un second runtime, pas remplacer brutalement la v1.

---

## Architecture cible

```text
                         ┌──────────────────────────┐
                         │ Scaleway Load Balancer   │
                         │  :80 / :443              │
                         └───────────┬──────────────┘
                                     │
                ┌────────────────────┼────────────────────┐
                │                    │                    │
         ┌──────▼──────┐      ┌──────▼──────┐      ┌──────▼──────┐
         │ node-1      │      │ node-2      │      │ node-3      │
         │ Caddy global│      │ Caddy global│      │ Caddy global│
         │ agent-node  │      │ agent-node  │      │ agent-node  │
         └──────┬──────┘      └──────┬──────┘      └──────┬──────┘
                │                    │                    │
                └────────── Docker Swarm overlay ─────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
       app service replicas   Ploydok API/web        workers/schedulers
              │                      │                      │
              └────────────── external HA deps ─────────────┘
                         Postgres HA / Redis HA / OCI registry
```

### Runtime modes

| Mode | Usage | Orchestration | Ingress |
|---|---|---|---|
| `docker` | v1, single VPS | `container_create/start/stop` | Caddy upstream vers container |
| `swarm` | v2 HA | `service create/update/scale/rollback` | Caddy global vers service Swarm |

Le mode `docker` ne doit pas régresser. Le mode `swarm` est une nouvelle surface explicite.

---

## Modèle de données

Ajouter des tables HA sans réécrire les tables v1.

### `runtime_clusters`

- `id`
- `name`
- `runtime`: `swarm`
- `provider`: `scaleway`
- `region`
- `status`: `pending | healthy | degraded | failed`
- `swarm_cluster_id`
- `manager_quorum_status`
- `created_at`, `updated_at`

### `runtime_nodes`

- `id`
- `cluster_id`
- `swarm_node_id`
- `hostname`
- `role`: `manager | worker`
- `availability`: `active | pause | drain`
- `state`: `ready | down | unknown`
- `public_ip`
- `private_ip`
- `labels` JSON
- `ingress_enabled`
- `last_seen_at`
- `last_heartbeat_error`

### `cluster_lb_bindings`

- `id`
- `cluster_id`
- `provider`: `scaleway`
- `zone`
- `load_balancer_id`
- `http_frontend_id`
- `https_frontend_id`
- `http_backend_id`
- `https_backend_id`
- `healthcheck_path`
- `last_sync_at`
- `last_sync_status`: `ok | drift | failed`
- `last_sync_error`

### Extensions app

Ajouter aux apps ou à une table `app_runtime_settings` :

- `runtime_mode`: `docker | swarm`
- `runtime_cluster_id`
- `replicas`
- `placement_constraints` JSON
- `update_parallelism`
- `update_delay_s`
- `rollback_on_failure`

Règle v2.0 : une app avec volume local ne peut pas avoir `replicas > 1` sauf driver de volume partagé explicitement configuré.

---

## Contrats API et agent

### Agent Swarm RPC

Ajouter les RPC côté agent Rust :

- `SwarmInfo`
- `ListSwarmNodes`
- `UpdateNodeAvailability`
- `ServiceCreate`
- `ServiceUpdate`
- `ServiceScale`
- `ServiceRollback`
- `ListServiceTasks`
- `InspectServiceHealth`

Les validations agent restent strictes :

- noms et labels préfixés `ploydok-*` ;
- pas de service hors cluster connu ;
- pas de bind host arbitraire ;
- secrets et configs uniquement via allowlist ;
- aucune exposition directe du socket Docker à l'API.

### API admin HA

Ajouter une surface admin :

- `GET /admin/ha/clusters`
- `POST /admin/ha/clusters`
- `GET /admin/ha/clusters/:id`
- `POST /admin/ha/clusters/:id/sync`
- `GET /admin/ha/clusters/:id/nodes`
- `POST /admin/ha/nodes/:id/drain`
- `POST /admin/ha/nodes/:id/activate`
- `GET /admin/ha/clusters/:id/load-balancer`
- `POST /admin/ha/clusters/:id/load-balancer/sync`

### API app HA

Ajouter la configuration app :

- `GET /apps/:id/ha`
- `PATCH /apps/:id/ha`
- `POST /apps/:id/ha/scale`
- `POST /apps/:id/ha/rollback`
- `GET /apps/:id/ha/tasks`

Le passage `docker -> swarm` doit être une action explicite avec confirmation UI.

---

## Scaleway Load Balancer

### Scope v2.0

Ploydok gère :

- création ou rattachement d'un Load Balancer existant ;
- frontends TCP `80` et `443` ;
- backends HTTP/HTTPS ;
- healthcheck vers `/.ploydok/ingress-health` ;
- sync des backend servers depuis les nodes ingress ;
- détection de drift ;
- bouton "Sync now" dans l'UI.

Ploydok ne gère pas en v2.0 :

- création automatique d'Instances Scaleway ;
- autoscaling de nodes ;
- migration DNS globale ;
- Multi-Cloud LB hors Scaleway standard.

### Backend servers

Sélection des IPs :

1. utiliser `private_ip` si le Load Balancer et les nodes sont sur le même Private Network ;
2. sinon utiliser `public_ip` ;
3. ne jamais ajouter un node `drain`, `down`, ou `ingress_enabled=false`.

Suppression prudente :

- un node absent n'est pas supprimé immédiatement du LB ;
- le sync le marque `stale`;
- suppression après timeout de drain ou action admin explicite.

### Healthcheck

Chaque Caddy global expose :

```text
GET /.ploydok/ingress-health
```

Réponse `200` uniquement si :

- Caddy est vivant ;
- la config active est la dernière version appliquée ;
- l'agent local est joignable ;
- le node n'est pas en drain.

---

## Caddy global

Le mode Docker actuel garde l'admin API Caddy.

En Swarm, introduire un `IngressController` :

- `DockerCaddyController` : comportement actuel ;
- `SwarmCaddyController` : rend une config complète depuis la DB, publie une Swarm config/secret versionnée, puis rolling-update le service Caddy global.

### Règles TLS

En HA Swarm, les domaines publics doivent utiliser :

- DNS-01 ;
- ou certificat manuel uploadé.

HTTP-01 par node est désactivé en HA v2.0 pour éviter les états ACME divergents entre replicas Caddy.

### Routage app

Le mode Swarm ne route pas vers `container_id`.

Caddy route vers :

```text
<service-name>:<runtime_port>
```

Le service Swarm porte les labels :

- `ploydok.kind=app`
- `ploydok.app_id=<id>`
- `ploydok.project_id=<id>`
- `ploydok.runtime=swarm`

---

## Runtime applicatif Swarm

### Deploy

Pour `runtime_mode=swarm`, le deploy devient :

1. build/pull image comme aujourd'hui ;
2. créer ou mettre à jour un service Swarm ;
3. appliquer env, secrets, limits, healthcheck, networks overlay ;
4. attendre convergence des tasks ;
5. appliquer config Caddy globale ;
6. enregistrer l'état de service et les tasks ;
7. publier events/logs via bus distribué.

Le blue/green container-level est remplacé par le rolling update Swarm.

Par défaut :

- `update_parallelism=1`
- `update_delay_s=10`
- `rollback_on_failure=true`
- healthcheck Ploydok conservé

### Scale

`POST /apps/:id/ha/scale` appelle `ServiceScale`.

Contraintes :

- `replicas >= 1`;
- `replicas > 1` interdit si volume local ;
- quotas cumulés = limites par replica multipliées par replicas ;
- scale refusé si le cluster manque de capacité connue.

### Rollback

Le rollback v2 Swarm utilise `docker service rollback`.

Ploydok garde un historique lisible côté `builds`, mais la source runtime devient l'état du service Swarm.

---

## Ploydok control plane HA

Le HA complet inclut Ploydok lui-même.

### Services

En mode HA, déployer :

- `ploydok-web` : replicated, stateless ;
- `ploydok-api` : replicated, stateless ;
- `ploydok-worker` : replicated ;
- `ploydok-scheduler` : replicated mais locké ;
- `ploydok-agent-manager` : sur managers ;
- `ploydok-agent-node` : global ;
- `ploydok-caddy` : global sur nodes ingress ;
- `buildkit` : replicated ou node-constrained selon cache strategy.

### Dépendances HA obligatoires

- Postgres HA externe.
- Redis/Valkey HA externe.
- Registry OCI externe ou registry avec storage objet partagé.
- Stockage backups externe.
- Secrets identiques sur toutes les replicas API.

### Refactors obligatoires

- Remplacer `withAppDeployLock` in-process par des locks DB advisory.
- Remplacer `eventBus` et `logBus` in-memory par Redis Pub/Sub ou Redis Streams.
- Protéger tous les crons par locks DB.
- Rendre les jobs idempotents sous plusieurs workers.
- Éviter toute dépendance à un filesystem local pour l'état produit.

---

## UI HA

Ajouter `Settings -> High Availability`.

### Cluster overview

Afficher :

- statut global ;
- managers et quorum ;
- workers ready/down/drain ;
- Caddy global replicas ;
- LB sync status ;
- control-plane replicas ;
- Postgres/Redis/registry health.

### Nodes

Actions :

- copier join command ;
- drain ;
- activate ;
- retirer après drain ;
- sync LB now.

### Scaleway LB

Afficher :

- LB id ;
- zone ;
- frontends ;
- backends ;
- healthchecks ;
- backend servers actifs/stale ;
- dernier sync ;
- erreurs provider.

### App HA

Dans `/apps/:id` :

- runtime mode ;
- replicas ;
- rolling strategy ;
- placement constraints ;
- tasks courantes ;
- tasks failed ;
- rollback ;
- avertissements stateful/volumes.

---

## Waves d'implémentation

### Wave 0 — Documentation et ADR

- [ ] Ajouter ce plan v2.
- [ ] Ajouter ADR `0011-swarm-scaleway-ha.md`.
- [ ] Ajouter la v2 HA comme roadmap post-v1, sans perturber les sprints v1.

### Wave 1 — Fondations DB/API

- [ ] Migrations `runtime_clusters`, `runtime_nodes`, `cluster_lb_bindings`, app HA settings.
- [ ] Routes admin HA.
- [ ] Feature flag `PLOYDOK_HA_SWARM_ENABLED`.
- [ ] Tests schema et auth admin.

### Wave 2 — Agent Swarm

- [ ] Étendre `agent.proto`.
- [ ] Implémenter RPC Rust Swarm.
- [ ] Ajouter validations allowlist.
- [ ] Tests unitaires agent sans cluster live quand possible.
- [ ] Tests intégration sous `docker swarm init`.

### Wave 3 — Control plane HA readiness

- [ ] Locks DB advisory pour deploys et jobs critiques.
- [ ] Bus temps réel distribué.
- [ ] Cron leader/lock.
- [ ] Dépendances externes obligatoires en HA mode.
- [ ] Tests multi-worker anti double-exécution.

### Wave 4 — Caddy global

- [ ] `IngressController` abstraction.
- [ ] Renderer Caddy Swarm.
- [ ] Service Caddy global.
- [ ] Endpoint `/.ploydok/ingress-health`.
- [ ] DNS-01 ou cert manuel obligatoire en HA.

### Wave 5 — Scaleway LB provider

- [ ] Client Scaleway Load Balancer.
- [ ] Storage token chiffré.
- [ ] Create/attach LB.
- [ ] Sync frontends/backends/healthchecks/backend servers.
- [ ] Drift detection.
- [ ] Tests avec mocks + staging live.

### Wave 6 — App runtime Swarm

- [ ] Runtime abstraction `docker | swarm`.
- [ ] Deploy service Swarm.
- [ ] Scale replicas.
- [ ] Rollback Swarm.
- [ ] Logs/stats/tasks service-level.
- [ ] Compose `deploy.replicas` supporté uniquement en Swarm.

### Wave 7 — UI complète

- [ ] Settings HA.
- [ ] Nodes management.
- [ ] Scaleway LB panel.
- [ ] Control plane health.
- [ ] App HA panel.
- [ ] États d'erreur et warnings.

### Wave 8 — Validation release

- [ ] Cluster Scaleway staging 3 nodes.
- [ ] Kill node ingress : trafic OK.
- [ ] Drain node : trafic OK.
- [ ] Kill API replica : UI/API OK.
- [ ] Kill worker replica : jobs OK.
- [ ] Rolling deploy sous trafic : zéro 5xx cible.
- [ ] Manager failure : comportement documenté selon quorum.

---

## Tests d'acceptance

- [ ] Une app stateless peut passer de `docker` à `swarm`.
- [ ] Une app Swarm `replicas=3` reste accessible quand un node worker tombe.
- [ ] Scaleway LB ne route plus vers un node drain/down après sync.
- [ ] Caddy global sert la même config sur tous les nodes ingress.
- [ ] Un rolling deploy raté rollback automatiquement.
- [ ] Deux workers ne déploient jamais la même app en parallèle.
- [ ] Deux schedulers ne lancent jamais le même cron en double.
- [ ] Les logs et events temps réel restent visibles après reconnexion à une autre replica API.
- [ ] Ploydok reste accessible quand une replica API/web tombe.
- [ ] Le mode Docker single-node existant garde ses tests verts.

---

## Risques

| Risque | Mitigation |
|---|---|
| Régression du mode Docker actuel | Runtime `swarm` optionnel, tests v1 obligatoires |
| Split-brain scheduler/workers | Locks DB advisory et jobs idempotents |
| Certificats divergents entre Caddy replicas | DNS-01 ou cert manuel uniquement en HA |
| LB Scaleway en drift | Sync périodique + sync manuel + état UI |
| Apps stateful scalées par erreur | Interdire `replicas > 1` avec volume local |
| Registry single point of failure | Registry externe obligatoire en HA |
| Manager quorum perdu | UI quorum + runbook recovery |
| Coût produit trop large | Waves séquentielles, feature flag, staging Scaleway obligatoire |

---

## Non-couvert v2.0

- Création automatique d'Instances Scaleway.
- Autoscaling de nodes.
- Kubernetes.
- Multi-cloud provider abstraction complète.
- Volumes distribués automatiques.
- Migration automatique d'une installation single-node existante vers HA.
- Zero-downtime upgrade de Postgres/Redis eux-mêmes.

---

## Références

- Scaleway Load Balancer API : `https://www.scaleway.com/en/developers/api/load-balancer/zoned-api/`
- Scaleway backends : `https://www.scaleway.com/en/docs/load-balancer/reference-content/configuring-backends/`
- Scaleway Load Balancer quickstart : `https://www.scaleway.com/en/docs/load-balancer/quickstart/`
- Docker Swarm services : `https://docs.docker.com/engine/swarm/services/`
- Docker Swarm networking : `https://docs.docker.com/engine/swarm/networking/`
