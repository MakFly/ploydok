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
- `--mode=abort` : écrit le rapport preflight puis sort avec le code `2`, sans modification.

Une ré-exécution préserve `master.key` et `.env` existants. Le script régénère uniquement les fichiers manquants, puis réécrit les templates systemd/compose à partir des flags fournis.

## Flags utiles

```bash
--http-port=8080
--https-port=8443
--data-dir=/var/lib/ploydok
--skip-docker-install
--manage-firewall
--yes
--unattended
```

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

L’upgrade vérifie les signatures, prend un snapshot Postgres avant pull/restart, puis restaure le `docker-compose.yml` précédent si le healthcheck post-upgrade échoue.
