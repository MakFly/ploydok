# Runbook — BuildKit rootless

## Contexte

Sprint 3 DoD item R5 : "Builds rootless vérifiés (pas de process root visible)".

Ce runbook documente la configuration rootless de BuildKit dans Ploydok, comment lancer l'audit, comment interpréter un échec, et comment recréer le container si besoin.

## Pourquoi rootless

Un daemon de build tournant en root sur l'hôte est une surface d'attaque critique : un exploit dans la couche de build peut mener à une escalade de privilèges root sur l'hôte. L'image officielle `moby/buildkit:*-rootless` exécute BuildKit dans un user namespace isolé (uid 1000 à l'intérieur, mappé sur un uid non-privilégié sur l'hôte), ce qui confine les dégâts en cas de compromission.

## Configuration utilisée

**Fichier** : `infra/docker-compose.yml`, service `buildkitd`

| Paramètre | Valeur | Raison |
|---|---|---|
| `image` | `moby/buildkit:v0.29.0-rootless` | Image officielle rootless BuildKit |
| `user` | `1000:1000` | Force uid/gid non-root explicitement |
| `privileged` | non défini (`false`) | Pas d'escalade de privilèges |
| `security_opt` | `seccomp=unconfined`, `apparmor=unconfined` | Voir § Limitations acceptées |
| `command` | `--oci-worker-no-process-sandbox` | Désactive le sandbox de process OCI interne |

**Fichier** : `infra/buildkit/buildkitd.toml`

```toml
[worker.oci]
  enabled = true
  snapshotter = "overlayfs"
```

**Choix `overlayfs`** : depuis kernel 5.13, le snapshotter overlayfs natif fonctionne en user namespace sans FUSE ni drivers userland. C'est l'option la plus rapide et la plus portable sur les distros modernes (Debian 12+, Ubuntu 22.04+, Fedora 35+).

`fuse-overlayfs` a été envisagé mais écarté : il nécessite (1) le module kernel `fuse` chargé sur l'hôte et (2) `/dev/fuse` exposé au container via `devices:` dans le compose — deux points qui échouent silencieusement sur certains hôtes.

`native` reste une option de repli sûre pour les kernels < 5.13 : lent mais bulletproof.

## Lancer l'audit

```bash
# Depuis la racine du repo
bash scripts/audit-rootless.sh

# Avec couleurs si terminal interactif
./scripts/audit-rootless.sh
```

Le script requiert que `make infra-up` ait été lancé au préalable. Il retourne exit 0 si conforme, exit 1 sinon.

### Checks effectués

| # | Check | Commande sous-jacente | Attendu |
|---|---|---|---|
| 1 | Container en cours d'exécution | `docker ps` | présent |
| 2 | User dans `docker inspect` | `docker inspect --format '{{.Config.User}}'` | `1000:1000` ou `1000` |
| 3 | uid dans le container | `docker exec id -u` | `1000` |
| 4 | Aucun processus root | `docker top -o pid,user,cmd \| awk 'NR>1 && $2=="root"' \| wc -l` | `0` |
| 5 | Container non-privilégié | `docker inspect HostConfig.Privileged` | `false` |
| 6 | Tag image rootless | `docker inspect Config.Image` | contient `rootless` |

### Sortie attendue

```
=== BuildKit rootless audit ===
Container: ploydok-buildkitd
Date:      2026-04-19T18:08:07Z

[OK]   container ploydok-buildkitd is running
[OK]   docker inspect User = 1000:1000 (expected 1000 or 1000:1000)
[OK]   uid inside container (docker exec id -u) = 1000
[OK]   no root-owned process in container (docker top -o pid,user,cmd | awk root count = 0)
[OK]   container is NOT privileged (HostConfig.Privileged=false)
[OK]   image tag contains 'rootless': moby/buildkit:v0.29.0-rootless

## Audit report — ploydok-buildkitd

| Check | Expected | Actual | Result |
|-------|----------|--------|--------|
| container running | yes | yes | **OK** |
| docker inspect User | `1000:1000` | `1000:1000` | **OK** |
| exec id -u | `1000` | `1000` | **OK** |
| root procs (docker top) | `0` | `0` | **OK** |
| privileged | `false` | `false` | **OK** |
| image rootless tag | contains `rootless` | `moby/buildkit:v0.29.0-rootless` | **OK** |

=== Summary: 6 passed, 0 failed ===
All checks passed — BuildKit is running rootless.
```

## Interpréter un FAIL

### FAIL: container not running

```bash
make infra-up
# attendre ~10s puis relancer l'audit
docker ps | grep buildkitd
```

### FAIL: docker inspect User ≠ 1000:1000

Le champ `user: "1000:1000"` est absent ou modifié dans `infra/docker-compose.yml`. Vérifier :

```bash
docker inspect ploydok-buildkitd --format '{{.Config.User}}'
```

Corriger dans `infra/docker-compose.yml` puis recréer le container (voir § Recréer le container).

### FAIL: uid inside container ≠ 1000

L'image n'est peut-être pas la version `-rootless`. Vérifier :

```bash
docker inspect ploydok-buildkitd --format '{{.Config.Image}}'
# doit contenir "rootless"
```

Si l'image est correcte mais l'uid reste 0, vérifier que `user: "1000:1000"` est bien dans le compose.

### FAIL: root process detected

Vérifier la liste complète :

```bash
docker top ploydok-buildkitd -o pid,user,cmd
```

Si `rootlesskit` apparaît avec user `root`, l'image n'est pas la variante rootless.
Si un processus de build est en root, le `--oci-worker-no-process-sandbox` est peut-être absent de la commande.

### FAIL: container is privileged

Retirer `privileged: true` du service `buildkitd` dans `infra/docker-compose.yml`, puis recréer le container.

### FAIL: image tag does not contain 'rootless'

Corriger l'image dans `infra/docker-compose.yml` :

```yaml
image: moby/buildkit:v0.29.0-rootless
```

## Recréer le container

Si des modifications ont été apportées au compose ou à la config buildkit, recréer le container via :

```bash
docker compose -f infra/docker-compose.yml up -d --force-recreate buildkitd
```

Puis relancer l'audit :

```bash
bash scripts/audit-rootless.sh
```

## Limitations acceptées

| Limitation | Raison | Impact prod |
|---|---|---|
| `seccomp=unconfined` | `rootlesskit` utilise `clone3` avec `CLONE_NEWUSER` qui est bloqué par le profil seccomp built-in de Docker. Testé sur Docker 29.4.0 : sans ce flag, `rootlesskit` échoue avec `operation not permitted`. En prod, un profil seccomp custom allowlistant les syscalls userns peut remplacer `unconfined`. | Réduit légèrement la protection seccomp. Acceptable en dev. |
| `apparmor=unconfined` | Certains hôtes Ubuntu/Debian bloquent les user namespaces imbriqués via AppArmor (profil `docker-default` trop restrictif). | Acceptable dev. En prod sur Ubuntu 22.04+, le profil AppArmor `unconfined` peut être remplacé par un profil custom qui autorise `clone`. |
| `--oci-worker-no-process-sandbox` | Sans sous-user-namespaces disponibles dans le container, BuildKit ne peut pas sandboxer les process OCI internes. Équivalent au comportement de Docker Desktop rootless — les étapes de build s'exécutent toutes à uid 1000, sans capabilities élevées. | Cohérent avec l'image rootless officielle. |

Ces flags sont documentés dans la documentation officielle BuildKit rootless comme prérequis standard sur la majorité des distributions Linux.

### Tentative de retrait de `seccomp=unconfined`

Le retrait a été tenté sur ce host (Docker 29.4.0, kernel 6.12.74+deb13+1-amd64). Résultat :

```
[rootlesskit:parent] error: failed to start the child: fork/exec /proc/self/exe: operation not permitted
```

`rootlesskit` requiert `clone3` avec `CLONE_NEWUSER`. Ce syscall est bloqué par le profil seccomp built-in. La solution correcte en prod est un profil seccomp custom — pas applicable en dev sans infrastructure supplémentaire.

## Branchement CI

Le script retourne exit 0 si conforme. Il peut être intégré dans un job CI post-`infra-up` :

```yaml
# Exemple GitHub Actions
- name: Audit BuildKit rootless
  run: bash scripts/audit-rootless.sh
```

## Sources

- Doc officielle BuildKit rootless : https://github.com/moby/buildkit/blob/master/docs/rootless.md
- Image Docker Hub : https://hub.docker.com/r/moby/buildkit/tags?name=rootless
- Profils seccomp Docker : https://docs.docker.com/engine/security/seccomp/
