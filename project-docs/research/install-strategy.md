# Stratégie d'installation — Ploydok

> Objectif : `curl install.ploydok.dev | bash` réussit sur un VPS vierge **ET** sur un VPS où nginx/apache2/autre tourne déjà, sans jamais casser l'existant sans consentement explicite.

---

## 1. Pré-requis durs (abort si manquant)

| Check | Action si échec |
|---|---|
| Linux kernel ≥ 5.10 | Abort, message clair |
| User namespaces activés (`/proc/sys/kernel/unprivileged_userns_clone = 1`) | Abort + lien doc pour activer |
| Docker ≥ 24 installé et daemon accessible | Proposer install Docker officiel (opt-in) |
| Architecture `x86_64` ou `aarch64` | Abort |
| ≥ 2 GB RAM libre, ≥ 10 GB disque libre | Warn si < 4 GB / 20 GB |
| `systemd` présent | Abort (v1 systemd-only) |

---

## 2. Détection environnement existant

Script `preflight.sh` exécuté avant toute modif :

```
- Services écoutant sur :80 et :443  (via `ss -tlnp`)
- Services systemd actifs : nginx, apache2, caddy, traefik, haproxy
- Containers Docker existants préfixés `ploydok-*` (install précédente ?)
- Firewall actif (ufw, firewalld, nftables rules)
- SELinux / AppArmor mode
- Timezone + NTP sync
```

Résultat loggé dans `/var/log/ploydok-install/preflight-<ts>.log`.

---

## 3. Gestion conflit ports 80/443

Si **:80 ou :443 occupé**, l'installeur propose 3 modes (interactif, ou via flags CLI pour non-interactif) :

### Mode A — `--mode=takeover` (défaut si serveur fraîchement dédié)
1. Arrêt + disable du service concurrent : `systemctl stop nginx && systemctl disable nginx`
2. Backup config existante : `/etc/nginx/` → `/var/backups/ploydok-install/nginx-<ts>.tar.gz`
3. Ploydok-Caddy bind :80 et :443
4. Rollback documenté : `ploydok-cli uninstall --restore-previous-proxy`

**Prompt interactif** :
```
⚠ nginx détecté sur :80/:443 avec 3 vhosts actifs :
  - example.com
  - api.example.com
  - admin.example.com

Options :
  [T] Takeover : arrêter nginx, migrer les vhosts vers Ploydok manuellement ensuite
  [C] Coexist : Ploydok sur ports alternatifs, reverse-proxy via votre nginx
  [A] Abort  : ne rien modifier
```

### Mode B — `--mode=coexist` (recommandé si reverse-proxy déjà en prod)
1. Ploydok-Caddy bind sur ports alternatifs : `:8080` et `:8443` (configurables)
2. Génération d'un snippet de config pour le proxy existant :

   **nginx** :
   ```nginx
   # /etc/nginx/snippets/ploydok.conf
   server {
     listen 443 ssl http2;
     server_name *.ploydok.example.com;
     ssl_certificate /etc/letsencrypt/live/...;
     location / {
       proxy_pass http://127.0.0.1:8080;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection $connection_upgrade;
     }
   }
   ```

   **apache2** : équivalent `mod_proxy` généré.

3. TLS : géré par le proxy frontal (Ploydok ne gère plus ACME dans ce mode) ; documenté dans `project-docs/operations/install/coexist.md`
4. Caddy interne désactive ACME, mode HTTP-only sur loopback

### Mode C — `--mode=abort`
Aucune modification. Retour code 2 avec rapport `/var/log/ploydok-install/preflight-<ts>.log`.

---

## 4. Flags CLI (non-interactif / IaC-friendly)

```
--mode=takeover|coexist|abort        # défaut: interactif
--http-port=8080                      # override port HTTP interne
--https-port=8443                     # override port HTTPS interne
--data-dir=/var/lib/ploydok           # override
--skip-docker-install                 # n'installe pas Docker même si manquant
--yes                                 # accepte tous les prompts
--unattended                          # + mode=coexist forcé + logs vers stdout
```

Exit codes :
- `0` : succès
- `1` : erreur générique
- `2` : abort utilisateur / mode=abort
- `3` : pré-requis manquant
- `4` : conflit non résolu

---

## 5. Étapes d'installation (post-preflight OK)

1. Créer user système `ploydok` (non-login, home `/var/lib/ploydok`)
2. Créer arbo `/var/lib/ploydok/{data,builds,backups,volumes,certs,logs}`
3. Générer master key → OS keyring ; fallback `/var/lib/ploydok/master.key` (perms 0400 user ploydok)
4. Générer certs mTLS agent ↔ api
5. Pull images signées (cosign verify) : `ploydok/api:<ver>`, `ploydok/agent:<ver>`, `caddy:<ver>`
6. Écrire `/etc/systemd/system/ploydok.service` + `ploydok.target`
7. Générer `docker-compose.yml` selon mode (takeover/coexist)
8. `systemctl daemon-reload && systemctl enable --now ploydok.target`
9. Attendre healthcheck `/health` OK (timeout 60s)
10. Afficher URL + QR code pour **enrollment passkey admin initial** (token one-shot 15 min)

---

## 6. Désinstallation propre

`ploydok-cli uninstall` :
- Stop + disable services
- `docker compose down` stack ploydok
- Demander confirmation avant suppression `/var/lib/ploydok` (backup auto dans `/var/backups/`)
- Si `--restore-previous-proxy` : ré-active nginx/apache2 depuis backup preflight
- Retire règles firewall ajoutées

---

## 7. Update / upgrade

`ploydok-cli upgrade` :
- Pull nouvelle image, vérif signature
- Snapshot DB SQLite avant migration (`backups/pre-upgrade-<ver>.sqlite.age`)
- Migrations Drizzle appliquées transactionnellement
- Health check, rollback auto si KO
- Zero-downtime pas garanti v1 (brève coupure API, apps users non affectées car Caddy continue à router)

---

## 8. Firewall

Script génère recommandations (applique uniquement avec `--manage-firewall`) :

**ufw** :
```bash
ufw allow 22/tcp
ufw allow 80/tcp     # ou 8080 si coexist
ufw allow 443/tcp    # ou 8443 si coexist
ufw deny 2019        # admin Caddy jamais exposé
ufw deny 5000        # registry local jamais exposé
```

**firewalld** et **nftables** : équivalents documentés.

---

## 9. Matrice de compat testée v1.0

| OS | Vierge | + nginx actif | + apache2 actif | + Docker custom |
|---|---|---|---|---|
| Ubuntu 22.04 | ✅ | ✅ (3 modes) | ✅ (3 modes) | ✅ |
| Ubuntu 24.04 | ✅ | ✅ (3 modes) | ✅ (3 modes) | ✅ |
| Debian 12 | ✅ | ✅ (3 modes) | ✅ (3 modes) | ✅ |
| Rocky Linux 9 | ⚠ best-effort | ⚠ | ⚠ | ⚠ |

Best-effort = supporté dans la CI mais pas bloquant pour release.
