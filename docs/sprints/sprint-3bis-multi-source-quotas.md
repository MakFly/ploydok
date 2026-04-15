# Sprint 3bis — Multi-source deploy & Ressource quotas

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

- [ ] 3 adapters Git (GitHub, GitLab, Gitea) interchangeables via interface
- [ ] Webhook signature vérifiée pour chaque provider
- [ ] Deploy from image fonctionne (public + privé registry)
- [ ] Quotas appliqués et vérifiés via `docker inspect`
- [ ] Test OOM : container killé, instance stable
- [ ] UI switch provider clair, pas de regression GitHub Sprint 3
- [ ] Tests e2e : 1 scénario par provider + 1 image deploy
- [ ] Network isolation : test pentest inter-projets → connexion refusée

---

## Risques sprint

| Risque | Mitigation |
|---|---|
| API Gitea varie selon version | Pinner min version (1.20+), tests sur 2 versions |
| Registry auth token exposé en process args | Utiliser `DOCKER_CONFIG` via fichier chiffré temp |
| Quota trop bas casse apps existantes | Migration : apps existantes = plan `custom` sans limite |
