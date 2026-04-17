# Runbook — Sprint 3 : infra registry + buildkit

## Vue d'ensemble

Depuis Sprint 3 (M1.3), `make infra-up` démarre trois services Docker :

| Service      | Image                           | Accès local            |
|--------------|---------------------------------|------------------------|
| `caddy`      | `caddy:2-alpine`                | 8180 (HTTP), 8543 (HTTPS), 2020 (admin) |
| `buildkitd`  | `moby/buildkit:v0.13.2-rootless` | socket unix via tmpfs `/run/user/1000` |
| `registry`   | `registry:2`                    | `127.0.0.1:5000`       |

---

## Démarrage de l'infra

```bash
make infra-up
```

Cette commande :
1. Crée le réseau Docker `ploydok-public` (si absent).
2. Lance **Caddy**, **buildkitd** et **registry** en mode detached.

Vérifier que les 3 services tournent :

```bash
docker ps --filter name=ploydok
# NAMES            STATUS
# ploydok-caddy-1      Up X seconds
# ploydok-buildkitd-1  Up X seconds
# ploydok-registry-1   Up X seconds
```

---

## Arrêt de l'infra

```bash
make infra-down
```

---

## Logs

```bash
make infra-logs            # logs Caddy
make infra-buildkit-logs   # logs buildkitd
make infra-registry-logs   # logs registry
```

---

## Smoke test du registry

Vérifie que le registry local accepte push/pull/delete :

```bash
make smoke-registry
```

Ce script (`scripts/smoke-registry.sh`) :
1. Pull `hello-world:latest` depuis Docker Hub.
2. Tag et push vers `127.0.0.1:5000/smoke:test`.
3. Liste les tags via l'API v2.
4. Supprime le manifest via l'API.

Variable d'environnement optionnelle :
```bash
PLOYDOK_REGISTRY_URL=127.0.0.1:5000 make smoke-registry
```

---

## Registry local

- URL : `http://127.0.0.1:5000`
- Pas d'authentification en développement.
- Suppression activée (`REGISTRY_STORAGE_DELETE_ENABLED=true`).
- Configuration : `infra/registry/config.yml` (monté en lecture seule).

Pour pousser depuis Docker, le registry local non-TLS doit être déclaré comme
`insecure-registries` dans `/etc/docker/daemon.json` :

```json
{
  "insecure-registries": ["127.0.0.1:5000"]
}
```

Puis redémarrer le daemon Docker : `sudo systemctl restart docker`.

---

## Workspace dev recommandé

```bash
mkdir -p ~/.ploydok-dev/{builds,registry,buildcache}
```

---

## Garbage collection manuelle

Pour libérer l'espace disque des layers non référencés :

```bash
make registry-gc
```

Équivalent :
```bash
docker compose -f infra/docker-compose.yml exec registry \
  registry garbage-collect --delete-untagged /etc/docker/registry/config.yml
```

Automatisation future : Wave 4 (M4.2) intégrera un cron via le worker API.

---

## Quota disque

Le volume `registry-data` est géré par Docker. Pour vérifier l'espace occupé :

```bash
du -sb /var/lib/docker/volumes/*registry-data* 2>/dev/null || \
  docker system df -v | grep registry
```

Limite recommandée en production : **20 GiB**. Configurer un quota LVM ou une
partition dédiée sur l'hôte.

---

## Production — ajout d'authentification htpasswd

En production, activer l'authentification basique sur le registry.

### 1. Générer le fichier htpasswd

```bash
# Installe apache2-utils si besoin
htpasswd -Bbn <user> <password> > infra/registry/htpasswd
```

Ne pas committer ce fichier. Le stocker dans le keyring système (référence :
`apps/api/src/keyring.ts`).

### 2. Mettre à jour `infra/registry/config.yml`

```yaml
auth:
  htpasswd:
    realm: Ploydok Registry
    path: /etc/docker/registry/htpasswd
```

### 3. Monter le fichier htpasswd dans le service `registry`

Dans `infra/docker-compose.yml`, section `volumes` du service `registry` :

```yaml
- ./registry/htpasswd:/etc/docker/registry/htpasswd:ro
```

### 4. Fournir les credentials à buildkitd / API

Configurer les secrets via variables d'environnement (jamais en clair dans
le compose) ou via un secret Docker Swarm / Kubernetes.

---

## buildkitd

- Image : `moby/buildkit:v0.13.2-rootless` (sans root).
- Socket accessible via tmpfs `/run/user/1000` dans le conteneur.
- Cache persisté dans le volume `buildkit-cache`.
- Config optionnelle : déposer des fichiers dans `infra/buildkit/` (monté en
  lecture seule sur `/etc/buildkit`).

Pour utiliser ce buildkitd depuis l'API :

```bash
export BUILDKIT_HOST=docker-container://ploydok-buildkitd-1
buildctl build ...
```

---

## Notes de sprint

- Sprint 3 M1.3 : ajout buildkitd + registry (ce runbook).
- Sprint 4 M4.2 : GC automatique via cron worker API.
- Sprint 6 : hardening TLS / mTLS, quota enforcement.
