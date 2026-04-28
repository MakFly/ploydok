# Sprint 9 — Installer production (one-liner + uninstall + upgrade) ⚠️ Partiel

**Durée estimée** : 1 semaine (installer + tests matrice).
**Objectif** : `curl -fsSL https://install.ploydok.dev | bash` pose Ploydok sur un VPS — vierge **ou** avec nginx/apache2 déjà en prod — sans jamais casser l'existant sans consentement explicite.
**Dépendances** : Sprint 6 (hardening, observabilité, doc user) terminé. La release v1.0.0 (sprint 6.9) dépend directement de ce sprint.

> **Origine** : reformulation des sections **6.7 Script d'installation** et **6.7-bis Tests d'installation** du `sprint-6-hardening-release.md`, repoussées hors scope sprint 6 le 2026-04-25. Spec source : [`docs/research/install-strategy.md`](../research/install-strategy.md).

---

## Pourquoi ce sprint existe

Aujourd'hui un auto-host doit suivre un README pas à pas (`docker compose up`, génération de secrets, mTLS, systemd, enrollment passkey). Tant qu'il n'y a pas d'installer testé, on ne peut pas :

- shipper la **v1.0.0** (le §6.7-bis tests d'installation est marqué « bloquant release ») ;
- garantir la **non-régression sur l'existant** (un VPS avec nginx en prod doit rester intact si l'admin choisit `coexist` ou `abort`) ;
- proposer une expérience comparable à Dokploy/Coolify côté onboarding.

Le sprint 6 réduit (décision 2026-04-25) a volontairement repoussé ces deux items pour tenir la semaine, en gardant la doc, les tokens API, le terminal web et l'observabilité — qui n'exigent pas de matrice VM.

---

## Scope

1. **Script d'install one-liner** (preflight + 3 modes + idempotence + non-interactif).
2. **Désinstallation** (`ploydok-cli uninstall`, restore proxy précédent).
3. **Upgrade** (`ploydok-cli upgrade`, snapshot DB, rollback auto).
4. **Firewall** (recommandations + application opt-in).
5. **Matrice de tests** (8 scénarios, VMs Vagrant ou GHA matrix) — bloquant release.

Hors scope explicite : Rocky/RHEL en niveau 1 (best-effort uniquement), zero-downtime upgrade (brève coupure API tolérée v1).

---

## 9.1 Pré-requis durs (preflight — abort si manquant)

| Check                                                                      | Action si échec                           |
| -------------------------------------------------------------------------- | ----------------------------------------- |
| Linux kernel ≥ 5.10                                                        | Abort, message clair                      |
| User namespaces activés (`/proc/sys/kernel/unprivileged_userns_clone = 1`) | Abort + lien doc pour activer             |
| Docker ≥ 24 installé et daemon accessible                                  | Proposer install Docker officiel (opt-in) |
| Architecture `x86_64` ou `aarch64`                                         | Abort                                     |
| ≥ 2 GB RAM libre, ≥ 10 GB disque libre                                     | Warn si < 4 GB / 20 GB                    |
| `systemd` présent                                                          | Abort (v1 systemd-only)                   |

Résultat preflight loggé dans `/var/log/ploydok-install/preflight-<ts>.log`.

---

## 9.2 Détection environnement existant

Script `preflight.sh` exécuté **avant toute modification système** :

- Services écoutant sur `:80` et `:443` (via `ss -tlnp`).
- Services systemd actifs : `nginx`, `apache2`, `caddy`, `traefik`, `haproxy`.
- Containers Docker existants préfixés `ploydok-*` (install précédente ?).
- Firewall actif : `ufw`, `firewalld`, `nftables`.
- SELinux / AppArmor mode.
- Timezone + NTP sync.

---

## 9.3 Gestion conflit ports 80/443 — 3 modes

Si `:80` ou `:443` est occupé, l'installeur propose 3 modes (interactif, ou via flag CLI) :

### Mode A — `--mode=takeover` (défaut serveur dédié vierge)

1. Arrêt + disable du service concurrent : `systemctl stop nginx && systemctl disable nginx`.
2. Backup config existante : `/etc/nginx/` → `/var/backups/ploydok-install/nginx-<ts>.tar.gz`.
3. Caddy interne de Ploydok bind `:80` et `:443`.
4. Rollback documenté : `ploydok-cli uninstall --restore-previous-proxy`.

Prompt interactif (extrait) :

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

### Mode B — `--mode=coexist` (recommandé reverse-proxy déjà en prod)

1. Caddy interne bind sur ports alternatifs : `:8080` / `:8443` (configurables).
2. Génération d'un snippet pour le proxy frontal :
   - **nginx** : fichier `/etc/nginx/snippets/ploydok.conf` avec `proxy_pass http://127.0.0.1:8080;` + headers `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`, upgrade WebSocket.
   - **apache2** : équivalent `mod_proxy` généré.
3. TLS géré par le proxy frontal (Ploydok désactive ACME en mode coexist) ; documenté dans `docs/install/coexist.md`.
4. Caddy interne en HTTP-only sur loopback.

### Mode C — `--mode=abort`

Aucune modification. Code retour `2`, rapport déposé dans `/var/log/ploydok-install/preflight-<ts>.log`.

---

## 9.4 Flags CLI (non-interactif / IaC-friendly)

```
--mode=takeover|coexist|abort        # défaut: interactif
--http-port=8080                      # override port HTTP interne
--https-port=8443                     # override port HTTPS interne
--data-dir=/var/lib/ploydok           # override data dir
--skip-docker-install                 # n'installe pas Docker même si manquant
--manage-firewall                     # applique les règles ufw/firewalld
--yes                                 # accepte tous les prompts
--unattended                          # + mode=coexist forcé + logs stdout
```

**Exit codes** :

| Code | Signification                       |
| ---- | ----------------------------------- |
| `0`  | Succès                              |
| `1`  | Erreur générique                    |
| `2`  | Abort utilisateur ou `--mode=abort` |
| `3`  | Pré-requis manquant                 |
| `4`  | Conflit non résolu                  |

---

## 9.5 Étapes d'installation (post-preflight OK)

1. Créer user système `ploydok` (non-login, home `/var/lib/ploydok`).
2. Créer arbo `/var/lib/ploydok/{data,builds,backups,volumes,certs,logs}`.
3. Générer master key → OS keyring ; fallback `/var/lib/ploydok/master.key` (perms `0400` user `ploydok`).
4. Générer certs mTLS agent ↔ api.
5. Pull images signées (vérif `cosign verify`) : `ploydok/api:<ver>`, `ploydok/agent:<ver>`, `caddy:<ver>`.
6. Écrire `/etc/systemd/system/ploydok.service` + `ploydok.target`.
7. Générer `docker-compose.yml` selon mode (`takeover` / `coexist`).
8. `systemctl daemon-reload && systemctl enable --now ploydok.target`.
9. Attendre healthcheck `/health` OK (timeout 60 s).
10. Afficher URL + QR code pour **enrollment passkey admin initial** (token one-shot 15 min).

---

## 9.6 Désinstallation propre

`ploydok-cli uninstall` :

- Stop + disable services systemd.
- `docker compose down` sur la stack ploydok.
- Demander confirmation avant suppression `/var/lib/ploydok` (backup auto dans `/var/backups/`).
- Si `--restore-previous-proxy` : ré-active nginx/apache2 depuis backup preflight (`/var/backups/ploydok-install/nginx-<ts>.tar.gz`).
- Retire les règles firewall ajoutées par l'installeur.

---

## 9.7 Upgrade

`ploydok-cli upgrade` :

- Pull nouvelle image, vérif signature `cosign`.
- Snapshot DB Postgres avant migration (`backups/pre-upgrade-<ver>.sql.age`).
- Migrations Drizzle appliquées transactionnellement.
- Healthcheck post-migration ; rollback auto si KO.
- **Zero-downtime non garanti v1** : brève coupure API ; les apps users ne sont pas affectées car Caddy continue de router.

---

## 9.8 Firewall (opt-in via `--manage-firewall`)

L'installeur génère des recommandations et ne les applique que si le flag est passé.

**ufw** :

```bash
ufw allow 22/tcp
ufw allow 80/tcp     # ou 8080 si coexist
ufw allow 443/tcp    # ou 8443 si coexist
ufw deny 2019        # admin Caddy jamais exposé
ufw deny 5000        # registry local jamais exposé
```

**firewalld** et **nftables** : équivalents documentés dans `docs/install/firewall.md`.

---

## 9.9 Matrice de compat testée v1.0

| OS            | Vierge        | + nginx actif | + apache2 actif | + Docker custom |
| ------------- | ------------- | ------------- | --------------- | --------------- |
| Ubuntu 22.04  | ✅            | ✅ (3 modes)  | ✅ (3 modes)    | ✅              |
| Ubuntu 24.04  | ✅            | ✅ (3 modes)  | ✅ (3 modes)    | ✅              |
| Debian 12     | ✅            | ✅ (3 modes)  | ✅ (3 modes)    | ✅              |
| Rocky Linux 9 | ⚠ best-effort | ⚠             | ⚠               | ⚠               |

« best-effort » = exécuté en CI, pas bloquant pour la release v1.0.

---

## 9.10 Tests d'installation (bloquant release)

8 scénarios joués via **VMs Vagrant** ou **GitHub Actions matrix** (référence : `docs/research/testing-strategy.md` § Test d'installation).

Pour chaque scénario, assertions minimales :

- [ ] Service `ploydok.target` actif après install.
- [ ] Healthcheck `/health` retourne 200.
- [ ] Login passkey OK (enrollment one-shot consommé, 2ᵉ login KO sans passkey).
- [ ] Mode `coexist` : service concurrent (nginx/apache2) toujours up et sert son vhost.
- [ ] Mode `takeover` : `uninstall --restore-previous-proxy` restaure nginx/apache2 fonctionnel à l'identique.
- [ ] Mode `abort` : zéro modif système (diff `/etc` vide hors logs preflight).
- [ ] Idempotence : 2ᵉ run installer = no-op ou upgrade propre.
- [ ] Re-install après uninstall propre = succès.

---

## Definition of Done

### Installer

- [ ] Script `install.sh` publié (signé) sur `https://install.ploydok.dev`.
- [x] Preflight implémente les 6 checks durs (kernel, userns, Docker, arch, RAM/disque, systemd).
- [x] 3 modes (`takeover` / `coexist` / `abort`) implémentés et testés.
- [x] Tous les flags CLI (`--mode`, `--http-port`, `--https-port`, `--data-dir`, `--skip-docker-install`, `--manage-firewall`, `--yes`, `--unattended`) câblés.
- [x] Exit codes `0/1/2/3/4` respectés.
- [x] Idempotent : ré-exécution = no-op ou upgrade.
- [x] Snippets reverse-proxy générés pour nginx + apache2.

### CLI ops

- [x] `ploydok-cli uninstall` (avec `--restore-previous-proxy`) implémenté.
- [ ] `ploydok-cli upgrade` (snapshot DB + migrations + rollback auto).

### Sécurité

- [x] Pull images vérifié via `cosign verify`.
- [ ] Master key générée via OS keyring (fallback fichier `0400`).
- [x] mTLS agent ↔ api auto-provisionné.
- [ ] Enrollment passkey admin one-shot (token 15 min).

### Tests

- [ ] Matrice 8 scénarios verte sur Ubuntu 22.04, 24.04, Debian 12 (3 modes × {nginx, apache2}).
- [ ] Rocky 9 exécuté en CI, échecs notés mais non-bloquants.
- [x] Suite tests installer ajoutée à la CI release (workflow GHA dédié).

### Docs

- [x] `docs/install/getting-started.md` (one-liner + 3 modes expliqués).
- [x] `docs/install/coexist.md` (snippets nginx/apache2 + TLS frontal).
- [x] `docs/install/firewall.md` (ufw/firewalld/nftables).
- [x] Section « Install » de `apps/docs/` (Astro + shadcn) à jour avec les 3 modes.

### Release

- [ ] Une fois ce sprint vert, le sprint **6.9 Release v1.0** peut démarrer (tag `1.0.0` + changelog).

---

## Risques

| Risque                                                        | Mitigation                                                                          |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Cassure d'un nginx en prod (mode takeover sans backup)        | Backup config systématique avant tout `systemctl stop` ; refus si backup KO.        |
| Conflit Docker daemon custom (rootless, contexte non-default) | Detect dans preflight, skip si `--skip-docker-install`, message clair sinon.        |
| Génération snippet nginx invalide (vhosts complexes)          | Mode coexist documenté comme « génère un point de départ », pas une config finale.  |
| Matrice VMs trop lente en CI                                  | Cacher images base Vagrant ; paralléliser par OS ; lancer matrice complète sur tag. |
| Rollback uninstall partiel (firewall, systemd, /var/lib)      | Tests dédiés `uninstall → re-install` dans la matrice ; checklist `uninstall.md`.   |

---

## Références

- Spec source : `docs/research/install-strategy.md`.
- Stratégie de tests : `docs/research/testing-strategy.md` § Test d'installation.
- Sprint d'origine : `docs/sprints/sprint-6-hardening-release.md` §6.7, §6.7-bis, §6.9.
- Roadmap : `docs/sprints/README.md`.
