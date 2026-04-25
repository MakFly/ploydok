# Gap Ploydok vs Dokploy — ce qui compte vraiment

**Date** : 2026-04-24
**Angle** : DevOps engineer. Ploydok = PaaS self-hosted single-host pour déployer des apps Git + DBs managées. Pas Kubernetes, pas multi-VPS, pas SaaS Enterprise. Donc 80% de la feature-list Dokploy est hors-scope pour nous.

---

## Ce qui compte (à faire)

### 1. Marketplace install réel — **priorité #1**

La route v0 actuelle (catalogue + copy compose) n'apporte rien qu'un `curl` ne fait. La vraie valeur c'est le 1-click : Redis, Minio, n8n, Uptime Kuma, Umami, etc. — services que personne ne veut builder depuis un Git.

Ce qu'il faut :

- Schema `services` (compose + env + domain + status).
- Parser du DSL Dokploy (`$SERVICE_PASSWORD_64_X`, `$SERVICE_FQDN_X`) — on adopte leur format tel quel, on hérite de leurs 100+ templates sans effort.
- Déploiement via l'agent Rust sur le réseau `ploydok-public` (déjà en place).
- Labels Caddy auto (on a déjà l'admin API branchée).
- Lifecycle minimal : start/stop/logs dans l'UI.

**Effort : ~1 sprint.** C'est le seul gros chantier qui justifie d'exister.

### 2. RBAC dans les orgs — **priorité #2**

Les workspaces existent déjà mais les rôles sont implicites. Dès qu'un user invite un collègue, on est exposé : le collègue peut tout faire, y compris supprimer les DBs.

Ce qu'il faut :

- Rôles `owner` / `member` (2 suffit, pas besoin des 4 de Dokploy).
- Flow d'invitation par email.
- Middleware auth qui check le rôle sur les mutations sensibles.

**Effort : M.** Obligatoire avant multi-user réel.

### 3. Backups S3 off-site — **priorité #3**

DBs sans backup externe = jouet. `pg_dump` local sur le même host ne survit pas à une perte de disque.

Ce qu'il faut :

- Schema `backup_destinations` (endpoint S3, creds chiffrés).
- Cron dump → upload S3.
- UI simple : ajouter destination + attacher à une DB.

**Effort : M.** Gating pour prod.

### 4. Audit Logs — **priorité #4**

Toute opération destructive (delete app/db, rotate secret, invite user) doit laisser une trace. Pas de compliance, juste du bon sens ops.

Ce qu'il faut :

- Table append-only `audit_events` (actor, action, target, timestamp).
- Middleware sur les routes de mutation.
- UI : timeline filtrable par workspace.

**Effort : S.** Cheap, gros ROI trust.

---

## Ce qui ne compte pas (à ne PAS faire)

| Feature Dokploy                                 | Pourquoi on skip                                                                                                        |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Remote Servers / Swarm / Cluster**            | YAGNI. Ploydok = single-host par design. Si un jour on scale, on réévalue.                                              |
| **Docker (vue host containers/images/volumes)** | `docker ps` en SSH fait le job pour debug. Refaire une UI = duplication d'outils existants.                             |
| **Schedules (cron jobs)**                       | Un service cron via marketplace (ofelia) ou un cron applicatif dans l'app suffit. Pas besoin d'un runner Ploydok natif. |
| **Traefik File System (éditeur config live)**   | Caddy auto-config via admin API déjà là. Exposer l'édition raw = foot-gun (user casse son reverse proxy).               |
| **Requests (logs reverse proxy)**               | Nice-to-have. Si besoin, un service marketplace (Umami/Plausible) couvre l'analytics.                                   |
| **Certificates (import mTLS custom)**           | Caddy auto-TLS couvre 99% des cas. Le 1% restant peut passer par config manuelle.                                       |
| **SSH Keys**                                    | Seulement utile si Remote Servers (qu'on skip).                                                                         |
| **Tags**                                        | Cosmétique. Le filtrage par workspace suffit.                                                                           |
| **Billing / License / SSO / Whitelabeling**     | SaaS Enterprise. Pas notre produit.                                                                                     |

---

## Plan concret

Un sprint dédié parité utile, dans cet ordre :

1. **Marketplace install réel** (débloquer la valeur user posée par la route v0).
2. **RBAC `owner`/`member` + invites**.
3. **Backups S3**.
4. **Audit Logs**.

Tout le reste : ignoré jusqu'à demande user explicite.

---

## Sidebar cible (après ce sprint)

```
Platform
├── Dashboard
├── Applications
├── Databases
├── Marketplace          ← v1 réel (pas v0)
├── Monitoring
└── AI Copilot (soon)

Workspace
├── Members              ← nouveau (RBAC)
└── Audit                ← nouveau

Settings
├── Profile / Security
├── Git providers
├── Registry
├── Notifications
└── Backup destinations  ← nouveau (S3)
```

Rien d'autre.
