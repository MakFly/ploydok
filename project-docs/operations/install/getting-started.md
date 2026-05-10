# Installer Ploydok

Ploydok v1 vise une installation systemd sur VPS Linux avec Docker 24+.

```bash
curl -fsSL https://install.ploydok.dev | bash
```

Pendant le développement, le script versionné est disponible dans le repo :

```bash
sudo installer/install.sh --mode=coexist --yes
```

## Modes

- `--mode=takeover` : Ploydok prend les ports `80` et `443`. Les configs proxy existantes sont sauvegardées dans `/var/backups/ploydok-install/` avant arrêt des services détectés.
- `--mode=coexist` : Ploydok écoute sur `127.0.0.1:8080` et `127.0.0.1:8443`; le proxy existant garde TLS/public edge.
- `--mode=bootstrap-http` : Ploydok expose l'UI en HTTP sur `0.0.0.0:8080` pour le premier setup depuis une IP allowlistée. Ce mode écrit `WEB_ORIGIN=http://<host>:<port>`, désactive le token de setup, et doit rester protégé par le security group/firewall du VPS.
- `--mode=abort` : écrit le rapport preflight puis sort avec le code `2`, sans modification.

Une ré-exécution préserve `master.key` et `.env` existants. Le script régénère uniquement les fichiers manquants, puis réécrit les templates systemd/compose à partir des flags fournis.

Par défaut, les fichiers d’exécution restent séparés des données mutables :

- `/opt/ploydok/docker-compose.yml` pour le descriptor Compose supervisé par systemd.
- `/var/lib/ploydok` pour `.env`, secrets, PKI, logs, builds, static assets et volumes applicatifs.

## Flags utiles

```bash
--http-port=8080
--https-port=8443
--public-host=212.47.x.y
--public-scheme=http
--public-port=8080
--install-dir=/opt/ploydok
--data-dir=/var/lib/ploydok
--skip-docker-install
--manage-firewall
--yes
--unattended
--runtime=swarm|compose      # default: compose
```

## Runtime : Swarm vs Compose

**Compose (par défaut)** — un container par service supervisé par `ploydok.service`. Mises à jour manuelles (`ploydok-cli upgrade`) ou via Watchtower si la stack le fournit. Mode safe pour tout VPS ; pas de prérequis Docker Swarm. Recommandé si MVP et qu'un downtime de quelques secondes lors d'une upgrade est acceptable.

**Swarm (`--runtime=swarm`)** — le control-plane (api, web) tourne en `replicas: 2`
sur Docker Swarm avec `update_config.order: start-first` + healthcheck-gated
cutover. Une nouvelle image `:edge` poussée par la CI déclenche un rolling
update (zéro 502 visible côté Caddy) via le timer systemd
`ploydok-update.timer` (toutes les 5 min). L'installer initialise un Swarm
single-node automatiquement (`docker swarm init --advertise-addr <ip>`) si la
machine n'en fait pas déjà partie. Les services stateful (postgres, redis,
registry, buildkitd) restent en `replicas: 1`.

**Compose (legacy)** — un container par service, supervisé par
`ploydok.service`. Pas de rolling update : les mises à jour sont manuelles
(`ploydok-cli upgrade`). À utiliser uniquement quand Swarm n'est pas
disponible (kernel sans cgroups v2, hôte mutualisé sans permissions Swarm,
runs CI éphémères).

Bascule existante compose → swarm : sauvegarder `/var/lib/ploydok/`,
`docker compose down` puis ré-exécuter `installer/install.sh --runtime=swarm`.
Les volumes nommés (postgres-data, redis-data, etc.) sont préservés s'ils
restent attachés à des services Swarm portant les mêmes noms.

`--unattended` force `coexist`, active `--yes`, et convient aux runs IaC.

Les images Ploydok sont vérifiées avec `cosign verify`. `PLOYDOK_INSTALL_SKIP_COSIGN=1` existe uniquement pour les tests contrôlés ; ne l’utilisez pas en production.

## Pré-requis contrôlés

- Linux kernel `>= 5.10`
- user namespaces activés
- Docker server `>= 24`
- architecture `x86_64` ou `aarch64`
- au moins `2 GB` RAM et `10 GB` disque libre
- systemd actif

Le rapport preflight est écrit dans `/var/log/ploydok-install/preflight-<timestamp>.log`.

## Désinstaller

```bash
sudo installer/ploydok-cli uninstall --yes
```

Pour restaurer le proxy sauvegardé après un takeover :

```bash
sudo installer/ploydok-cli uninstall --yes --restore-previous-proxy
```

## Upgrade

```bash
sudo installer/ploydok-cli upgrade --version=1.0.1
```

L’upgrade normal est `control-plane only` : il met à jour `ploydok-api`, `ploydok-web`, `ploydok-agent` et `ploydok-adminer`, mais ne recrée pas `ploydok-caddy`, les apps, les databases utilisateur, les réseaux projet, ni les volumes.

L’upgrade vérifie les signatures, prend un snapshot Postgres avant pull/restart, applique les migrations control-plane, puis restaure le `docker-compose.yml` précédent si `/health/ready` échoue.

Pour une release qui modifie volontairement l’ingress/Caddy :

```bash
sudo installer/ploydok-cli upgrade --version=1.0.1 --include-data-plane
```

Ce chemin peut couper des connexions HTTP/WebSocket actives et doit être traité comme une opération de maintenance.
