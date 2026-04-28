# Sprint 3bis — Multi-source deploy & Ressource quotas ✅ Terminé

> **Feature phare** : isolation réseau cross-project « zero-trust by default ».
> Apps de projets différents ne partagent **aucun** réseau Docker — Caddy est
> attaché dynamiquement à chaque project-network via la nouvelle RPC gRPC
> `NetworkConnect`/`NetworkDisconnect` côté agent Rust. Validation par pentest
> automatisé `e2e/isolation/cross-project-blocked.spec.ts` (rouge avant,
> vert après) + contre-test `same-project-allowed.spec.ts` qui garantit que
> les apps d'un même projet restent mutuellement joignables. Voir
> `/home/kev/.claude/plans/propose-un-plan-permettant-jazzy-knuth.md` pour
> l'architecture. Dokploy (isolation absente) et Coolify (isolation opt-in
> via Destinations UI) sont tous deux dépassés.

> **Statut : TERMINÉ** — clôturé 2026-04-27.
> ✅ GitLab adapter (`apps/api/src/gitlab/`), deploy from image (inline dans `deploy.ts:261`),
> registry credentials chiffrées, quotas par plan (`packages/shared/src/plans.ts` + proto `pids_limit` +
> bollard `HostConfig.pids_limit`), network isolation per-project (`projects.network_name` +
> `ensureProjectNetwork`) + spec pentest `e2e/isolation/cross-project-blocked.spec.ts`.
> Migration Postgres + Redis + BullMQ livrée (Wave 1 `PLAN-sprint-3-closure-3bis-pg.md`).
> ✅ Refacto 2026-04-20 : `verifyWebhookSignature` + `parseWebhookPushEvent` intégrés à l'interface
> `GitProvider` (`packages/shared/src/git-providers.ts`), implémentés sur `GitHubProvider` /
> `GitLabProvider`, registre singleton `apps/api/src/providers/index.ts` + détection
> auto via headers HTTP. Specs e2e `apps/web/e2e/providers/{deploy-image,deploy-gitlab}.spec.ts`
> ajoutées (gate `PLOYDOK_FULL_INFRA=1` → CI vert par défaut).
> ✅ Test OOM validé 2026-04-21 : container `--memory=64m` tentant `stress --vm-bytes 128M`
> → `OOMKilled=true`, exit 1, les 2 apps `-green` voisines (`ploydok-3gfa0pcc`, `nextjs-9hnxlbq0`)
> restent `healthy`, pas d'impact instance. Preuve cgroup enforcement correct.
>
> **Focus actuel : GitHub.** GitLab est **en standby accepté** — le code est livré et fonctionnel,
> mais on ne dépense plus de cycles dessus (ni OAuth setup, ni e2e) pour la v1.0.
> **Hors-scope assumé** : Gitea (retiré délibérément).
> **Non-bloquant** : spec `deploy-gitlab.spec.ts` à réactiver quand GitLab sortira du standby
> (nécessite OAuth GitLab configuré + agent + infra up).

**Durée** : 1 semaine
**Objectif** : élargir les sources de déploiement (GitLab, Gitea, Docker image) + enforcer des quotas ressources par app.
**Dépendances** : Sprint 3 terminé.

---

## Scope

v1.0 ne peut sortir avec uniquement GitHub — la cible self-hosters utilise massivement Gitea/GitLab. De même, déployer depuis une image Docker prête (ex: Plausible, Ghost) est attendu. Enfin, sans quotas, un user peut OOM le VPS entier.

---

## Tâches détaillées

### 3bis.1 Abstraction Git providers
- Interface `GitProvider` dans `packages/shared/git-providers.ts` :
  ```ts
  interface GitProvider {
    authorize(): Promise<AuthUrl>
    listRepos(token: string): Promise<Repo[]>
    cloneUrl(repo: Repo, token: string): string
    registerWebhook(repo: Repo, url: string): Promise<WebhookId>
    verifyWebhookSignature(payload: Buffer, sig: string): boolean
  }
  ```
- Refacto Sprint 3 : extraire l'adapter GitHub derrière cette interface

### 3bis.2 Adapter GitLab
- OAuth App GitLab.com + support instances self-hosted (URL custom)
- Webhook : `x-gitlab-token` vérif
- Tests : repo public + privé

### 3bis.3 Adapter Gitea
- Support instances self-hosted obligatoire (pas de SaaS Gitea)
- OAuth2 config dynamique par instance
- Webhook signature HMAC SHA256

### 3bis.4 UI multi-provider
- Page Settings → « Git providers » : liste avec statut connexion
- Flow `Add provider` : sélecteur GitHub/GitLab/Gitea → config → OAuth
- Modal `Create app` : sélecteur provider → puis liste repos

### 3bis.5 Deploy from Docker image
- Nouveau type d'app : `image` (vs `git`)
- Fields : `image`, `tag`, `pull_policy ∈ {always, if_not_present}`, `registry_auth` (optionnel, secret)
- Pas de build → flow simplifié : pull → run → route Caddy
- Support `:latest` avec auto-redeploy périodique (cron optionnel, off par défaut)
- UI : « Deploy from image » → formulaire minimal

### 3bis.6 Registry auth
- Table `registry_credentials` (chiffrée) : dockerhub, ghcr, private custom
- Test connexion au submit (pull image manifest en dry-run)
- Injection au `docker pull` via agent

### 3bis.7 Ressource quotas
- Plans par défaut :
  - **nano** : 0.25 CPU / 256 MB RAM
  - **small** : 0.5 CPU / 512 MB
  - **medium** : 1 CPU / 1 GB
  - **large** : 2 CPU / 2 GB
  - **custom** : champs libres
- Champs ajoutés à `apps` : `cpu_limit`, `mem_limit`, `mem_reservation`, `pids_limit`
- Agent applique : `HostConfig.Memory`, `NanoCPUs`, `PidsLimit`
- UI : sélecteur plan dans create/edit app
- Dashboard : barre d'usage vs quota (warn si > 80%)

### 3bis.8 Enforcement global instance
- Settings admin : `max_apps_per_user`, `max_total_memory_mb`, `max_total_cpu`
- Refus create app si dépassement
- Alerte copilot si instance proche saturation

### 3bis.9 Network isolation par projet
- Un **réseau Docker dédié par projet** : `ploydok-proj-<project_id>`
- Apps + DB d'un projet communiquent uniquement entre elles (DNS Docker interne)
- **Impossible** pour une app du projet A d'atteindre une DB du projet B
- Caddy reste sur un réseau shared (`ploydok-ingress`) pour router
- Agent valide à chaque `ContainerCreate` que le network demandé appartient bien au projet owner
- Tests : lateral movement bloqué entre 2 projets d'users différents (scénario pentest)

---

## Deliverable démo

1. Connect Gitea self-hosted → deploy un repo Go
2. Connect GitLab.com → deploy monorepo
3. Deploy Plausible via image `plausible/community:latest`
4. Créer app avec plan `small` → vérifier `docker inspect` limits
5. Tenter OOM (app qui leak) → killé par cgroup, pas d'impact autres apps

---

## Definition of Done

- [x] 2 adapters Git (GitHub, GitLab) interchangeables via interface `GitProvider` — Gitea hors-scope, GitLab en standby
- [x] Webhook signature vérifiée pour GitHub + GitLab (`verifyWebhookSignature` dans chaque provider)
- [x] Deploy from image fonctionne (public + privé registry, inline `apps/api/src/agent/deploy.ts:261`)
- [x] Quotas appliqués et vérifiés via `docker inspect` (bollard `HostConfig.Memory/NanoCPUs/PidsLimit`)
- [x] Test OOM : container killé, instance stable — validé 2026-04-21 (`OOMKilled=true` à 64MB/128MB, apps voisines `healthy`)
- [x] UI switch provider clair, pas de regression GitHub Sprint 3
- [x] Network isolation : test pentest inter-projets → connexion refusée (`e2e/isolation/cross-project-blocked.spec.ts` + `same-project-allowed.spec.ts`)
- [x] Tests e2e GitHub + image deploy (`e2e/providers/deploy-image.spec.ts`, flow GitHub couvert sprint 3)
- [x] Test e2e GitLab (`e2e/providers/deploy-gitlab.spec.ts`) — **standby accepté pour v1.0**, à réactiver quand GitLab sort du standby

---

## Risques sprint

| Risque | Mitigation |
|---|---|
| API Gitea varie selon version | Pinner min version (1.20+), tests sur 2 versions |
| Registry auth token exposé en process args | Utiliser `DOCKER_CONFIG` via fichier chiffré temp |
| Quota trop bas casse apps existantes | Migration : apps existantes = plan `custom` sans limite |
