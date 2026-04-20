# Sprint 3 — Deploy from Git ✅ Terminé (code) · ⏳ e2e à exécuter

> **Statut : CODE TERMINÉ** — audit 2026-04-20. Pipeline complet câblé :
> BuildKit rootless + cache (Dockerfile + Nixpacks) + blue-green (`runner.ts:372`) + GC
> registry avec protection DB-driven (tag container live + latest succeeded) + healthchecks
> custom incluant `start_period` + UI `/apps/$id/*` complète + DeployButton.
> **Reste à exécuter par l'utilisateur : `make dod`** (11 specs Playwright → régénère `sprint-3-DoD.md`).

**Durée** : 1 semaine
**Objectif** : connecter un repo GitHub → app live sur un domaine en < 2 min.
**Dépendances** : Sprints 1 & 2 terminés.

---

## Scope

C'est LE sprint cœur du produit. Tout le reste n'a de valeur que si ça marche ici.

---

## Tâches détaillées

### 3.0 Abstraction GitProvider (préparation Sprint 3bis)
- Interface `GitProvider` dans `packages/shared/git-providers.ts` — GitHub en sera la 1re implémentation
- Évite une refacto douloureuse quand GitLab/Gitea arrivent au Sprint 3bis

### 3.1 GitHub OAuth App
- Créer OAuth App GitHub (callback `https://<instance>/auth/github/callback`)
- Flux OAuth classique, token stocké chiffré (AES-GCM) dans `secrets`
- Scopes minimaux : `repo` (privé), `read:user`
- UI : page « Connect GitHub » dans Settings

### 3.2 Sélection repo
- `GET /github/repos` → liste paginée (cache 5 min)
- UI : modal « Create app » → sélecteur repo + branch
- Enregistrement : row `apps` avec `git_provider`, `repo_full_name`, `branch`

### 3.3 Clone & workspace éphémère
- Worker (BullMQ-lite ou queue SQLite maison) consomme jobs `deploy.requested`
- Workspace temporaire `/var/lib/ploydok/builds/<app_id>/<build_id>/`
- Git clone shallow (depth 1) via process isolé
- Cleanup automatique après build (succès ou échec)

### 3.4 Détection build method + monorepo support
- Si `Dockerfile` à la racine → mode Docker
- Sinon → Nixpacks (CLI wrappée, binaire téléchargé au premier deploy)
- Afficher dans UI la méthode détectée, permettre override manuel
- **Support monorepo** : champs configurables par app
  - `root_dir` (build context, ex: `apps/web/`)
  - `dockerfile_path` custom
  - `install_command_override`, `build_command_override`, `start_command_override`
  - `watch_paths` : ne trigger auto-deploy que si ces paths changent dans le commit

### 3.5 Build rootless + cache persistant
- BuildKit en mode rootless via `buildctl` + `buildkitd` dans container dédié (lancé par agent)
- User namespace, seccomp profile strict, no-new-privileges
- Logs streamés en temps réel via WebSocket `/ws/apps/:id/build/:buildId`
- Image taggée `ploydok/<app_id>:<build_id>` + `:latest` dans registry local
- **Cache persistant** :
  - Volume `/var/lib/ploydok/buildcache/<app_id>/`
  - `--cache-from type=local` + `--cache-to type=local,mode=max`
  - Gain mesuré attendu : 3–5× plus rapide sur rebuilds
  - GC : prune automatique > 10 GB par app

### 3.6 Registry local + GC
- Container `registry:2` privé, bind `127.0.0.1:5000`
- Auth basique (user/pass généré au boot, stocké keyring)
- **Politique GC multi-niveau** :
  - Toujours garder : `:latest` + 3 dernières images taguées `<build_id>` par app
  - Post-deploy : prune orphelines de l'app après chaque build réussi
  - Cron quotidien 04:00 UTC : `registry garbage-collect` global
  - **Disk guard** : si `/var/lib/ploydok/registry` > 80% du quota (défaut 20 GB) → GC agressif (keep :latest + 1 rollback)
  - Protection : image avec label `ploydok.protected=true` (= en cours d'exécution) jamais supprimée
- Config `registry.yaml` : `max_size_gb`, `keep_per_app`, `gc_schedule`
- Dashboard admin : widget `Registry usage` par app + bouton `Prune now`

### 3.7 Run & routing zero-downtime (blue-green)
- Agent : `ContainerCreate` avec env vars + network `ploydok-net` — nouveau container démarre **en parallèle** de l'ancien
- **Healthchecks custom** par app :
  - `healthcheck.path` (défaut `/`)
  - `healthcheck.port` (défaut PORT env)
  - `healthcheck.interval` (défaut 5s)
  - `healthcheck.timeout` (défaut 3s)
  - `healthcheck.retries` (défaut 6, soit ~30s total)
  - `healthcheck.start_period` (défaut 0s, allonger pour apps à boot lent)
- **Blue-green via Caddy** :
  1. Nouveau container `app-<id>-<build_id>` démarre
  2. Attente healthcheck OK (sinon fail deploy, garder ancien live)
  3. Caddy `upsertRoute` switch upstream vers nouveau
  4. Grace period 30s (connections en cours)
  5. Stop + remove ancien container
- Rollback : garder les 3 derniers containers arrêtés, `POST /apps/:id/rollback` = simple swap upstream Caddy + restart old

### 3.8 UI `/apps/:id`
- Header : nom app, status (running/building/failed/stopped), domaine cliquable
- Tabs : Overview, Logs, Builds, Settings, Env, Domains
- Overview : stats CPU/RAM live, dernier deploy, branche suivie
- Logs : stream WS, filtre texte, download
- Builds : liste des 10 derniers, logs archivés, bouton rollback
- Actions : Stop, Restart, Redeploy

### 3.9 Trigger manuel
- Bouton « Deploy » → crée job `deploy.requested` avec commit SHA courant de la branche
- Affichage build en cours en temps réel

---

## Deliverable démo

1. Connecter GitHub
2. Sélectionner repo `nextjs-starter`
3. Cliquer Deploy
4. Logs build streamés → image build en ~60s
5. Container live en ~20s
6. URL `nextjs-starter.demo.ploydok.dev` → app affichée
7. Total : < 2 min

---

## Definition of Done

- [ ] Deploy Next.js réussi (Dockerfile et Nixpacks)
- [ ] Deploy app Python (FastAPI) réussi via Nixpacks
- [ ] Deploy monorepo (root_dir + command overrides) réussi
- [ ] Build cache : 2e build < 40% du temps du 1er
- [ ] Zero-downtime vérifié : `ab` ou `hey` pendant redeploy → 0 requête 5xx
- [ ] Healthcheck custom (path + retries) respecté
- [ ] Logs build visibles en temps réel, latence < 500ms
- [ ] Rollback fonctionne en < 10s
- [ ] Builds rootless vérifiés (pas de process root visible)
- [ ] Cleanup workspace + images anciennes auto
- [ ] Test e2e Playwright : flow complet repo → app live (incluant zero-downtime assertion)

---

## Risques sprint

| Risque | Mitigation |
|---|---|
| Nixpacks détection incorrecte | Override manuel + doc top-10 langages supportés |
| Build lent (> 5 min) → UX médiocre | Cache layers BuildKit, logs clairs |
| OAuth GitHub rate-limit | Cache ETag, pagination raisonnée |
| Port collision sur host | Tout en réseau Docker interne, Caddy expose uniquement :443 |
