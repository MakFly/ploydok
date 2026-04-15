# Sprint 4 — Secrets, domaines, DB one-click

**Durée** : 1 semaine
**Objectif** : donner l'autonomie complète pour déployer une app réelle de production.
**Dépendances** : Sprint 3 terminé.

---

## Scope

Une app de prod a besoin de : env vars sécurisées, domaine custom avec TLS, une base de données. C'est l'objet de ce sprint.

---

## Tâches détaillées

### 4.1 Env vars chiffrées & scopées
- Chiffrement AES-256-GCM, clé dérivée de master key (OS keyring)
- Chaque secret = row `secrets` avec `app_id`, `key`, `ciphertext`, `nonce`, **`scope ∈ {shared, production, preview, development}`**
- Injection contextuelle au runtime selon type de deploy :
  - Deploy `production` → merge `shared` + `production`
  - Deploy `preview` (PR) → `shared` + `preview`
  - Même clé dans `shared` et `production` → `production` gagne
- UI : page `/apps/:id/env` → onglets par scope, bouton « Reveal » (challenge passkey)
- Jamais loggé, jamais retourné en GET par défaut (sauf reveal explicite)
- Import/export `.env` (export chiffré uniquement), format supporte `@scope` préfixe

### 4.2 Domaines custom + wildcard TLS
- UI : page `/apps/:id/domains`
- Ajout domaine → génération token DNS vérif (`TXT _ploydok-verify.<domain>`)
- Poll DNS toutes les 30s pendant 10 min
- Une fois vérifié → Caddy `upsertRoute` avec TLS auto
- **2 modes TLS** :
  - **HTTP-01** (défaut) : simple, pas de wildcard
  - **DNS-01** : pour wildcards `*.app.domain.com`. Providers pluggables : Cloudflare, Route53, OVH, DigitalOcean (tokens API stockés en secrets chiffrés)
- Multi-domaines par app supportés
- Suppression → `removeRoute` + révocation cert

### 4.2-bis Protection apps exposées (Caddy middlewares)
Par app, activables indépendamment :
- **HTTP Basic Auth** : user/pass chiffrés, push config Caddy `basicauth` middleware
- **IP allowlist** : liste CIDR (IPv4+IPv6), Caddy `remote_ip` matcher
- **Rate-limit public** : req/s par IP configurable (défaut off), Caddy `rate_limit` module
- UI : `/apps/:id/protection` avec 3 toggles + config
- Cas d'usage : staging protégé, admin panel limité à VPN, anti-DDoS basique

### 4.2-ter Import TLS cert manuel
- UI : `/apps/:id/domains/:domain/tls` → upload `cert.pem` + `key.pem`
- Validation : parse + check expiry, SAN matching domain, chaîne complète
- Stockage chiffré (secrets table, type `tls_cert`)
- Caddy : `tls <internal_path_cert> <internal_path_key>` (désactive ACME pour ce domaine)
- Renouvellement : rappel 30j avant expiry (notif + dashboard)
- Cas d'usage : certs entreprise wildcard déjà émis

### 4.3 Templates DB one-click
- Définir 3 templates : Postgres 16, Redis 7, MongoDB 7
- Format : YAML interne (pas Docker Compose direct pour contrôle fin)
- Fields : image, version, ressources par défaut, volumes persistants, env vars auto (password généré fort)
- UI : `/databases` → bouton « Create database » → sélecteur type + nom + plan (small/medium/large)

### 4.4 Lifecycle DB
- Agent crée volume nommé `ploydok-db-<id>`
- Container DB lancé sur `ploydok-net`, pas d'exposition publique par défaut
- Password master chiffré, reveal challenge passkey
- Backup manuel : bouton « Backup now » → dump dans `/var/lib/ploydok/backups/<db_id>/<ts>.sql.age`
- Connection string fournie en UI avec bouton « Copy »

### 4.5 Linking app ↔ DB + rotation orchestrée
- UI dans `/apps/:id/env` : bouton « Link database »
- Sélection DB → injection auto des env vars (`DATABASE_URL`, `POSTGRES_*`, etc.)
- Vars marquées « linked »

**Rotation auto password DB** :
- Opt-in par DB, fréquence configurable (30/60/90j, défaut **90j**, ou `manual`)
- Trigger : cron interne + bouton UI `Rotate now`
- Algorithme (Postgres/Mongo) :
  1. Génère nouveau password (32 chars, entropy vérifiée)
  2. Crée user `<dbuser>_new` avec mêmes droits
  3. **Double-write period 5 min** : pousse nouvelle `DATABASE_URL` aux apps linkées via rolling redeploy blue-green (Sprint 3)
  4. Vérifie chaque app healthy
  5. Révoque ancien user
  6. Fail de redémarrage app → **rollback auto** (Caddy swap back, ancien user maintenu)
- Redis : nouveau `requirepass` + `CONFIG SET` (pas de downtime)
- **Secret history** : N-1 gardée 24h pour debug post-rotation
- Notif Discord/Slack sur rotation
- Apps externes (creds manuelles) : warn UI + confirmation explicite avant rotation

### 4.5-bis Deploy hooks (pre/post)
- Champs par app : `hooks.pre_deploy` (string commande) et `hooks.post_deploy`
- Exécutés dans container éphémère basé sur l'image build (mêmes env vars, même working dir)
- Exemples usage : `prisma migrate deploy`, `npm run seed`, cache warm-up, notif webhook
- **pre_deploy échoue → deploy abandonné, ancien container reste live** (zero-downtime préservé)
- **post_deploy échoue → deploy marqué succès-avec-warning**, alerte UI
- Logs hooks visibles dans l'onglet Builds
- Timeout configurable (défaut 5 min)

### 4.6 Webhook auto-deploy
- GitHub webhook handler `/webhooks/github`
- Vérif signature HMAC
- Sur `push` sur branche suivie → enqueue `deploy.requested`
- UI : `/apps/:id/settings` → toggle « Auto-deploy on push »

### 4.7 Backups scheduler
- Cron SQLite interne (table `schedules`)
- Pour chaque DB : backup quotidien 03:00 UTC par défaut
- Destination : S3/R2 (credentials en secrets)
- Chiffrement client-side via `age` (clé user, pas serveur)
- Rétention : 7 jours par défaut, configurable
- UI : `/databases/:id/backups` → liste, download, restore

### 4.8 Restore
- Bouton « Restore » sur un backup → challenge passkey → stop DB → restore dump → start
- Logs de restore streamés
- Test auto post-restore : connection + query simple

---

## Deliverable démo

1. Créer app Next.js déjà connectée (Sprint 3)
2. Ajouter env var `NEXT_PUBLIC_API_URL` via UI
3. Ajouter domaine custom `myapp.com` → vérif DNS → TLS actif en 1 min
4. Créer Postgres → link à l'app → `DATABASE_URL` injectée
5. Push un commit → auto-deploy déclenché
6. Backup manuel Postgres → restore sur nouveau container

---

## Definition of Done

- [ ] Env vars chiffrées vérifiées (inspect DB → ciphertext illisible)
- [ ] Scopes env vars : preview reçoit `shared + preview`, prod reçoit `shared + production`
- [ ] Domaine custom + TLS fonctionne sur domaine réel (HTTP-01)
- [ ] Wildcard `*.domain.com` fonctionne via DNS-01 (Cloudflare)
- [ ] Deploy hooks pre/post exécutés, failure pre = pas de swap Caddy
- [ ] 3 templates DB testés, volumes persistent après restart
- [ ] Auto-deploy webhook signé et vérifié
- [ ] Backup + restore Postgres vérifié avec dataset réaliste (100 MB)
- [ ] Secrets jamais visibles en logs (grep `ploydok.log` après flow complet)
- [ ] Basic Auth + IP allowlist + rate-limit par app fonctionnels (Caddy config validée)
- [ ] Upload cert TLS manuel + Caddy bind + alerte expiry OK
- [ ] Rotation DB orchestrée testée : 3 apps linkées, 0 downtime, rollback auto sur fail
- [ ] Test e2e : création complète app + DB + domaine

---

## Risques sprint

| Risque | Mitigation |
|---|---|
| ACME rate-limit Let's Encrypt | Staging env en dev, cert réels uniquement en prod |
| Restore DB en prod = risqué | Challenge passkey obligatoire + confirm texte |
| S3 creds mal gérées | Stockées en secrets chiffrés comme tout le reste |
| DNS propagation lente | UI claire : « vérification en cours, peut prendre 10 min » |
