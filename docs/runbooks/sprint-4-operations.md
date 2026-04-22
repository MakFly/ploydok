# Runbook — Sprint 4 : Secrets, domaines, DB one-click

Ce runbook couvre les opérations quotidiennes liées aux features du sprint 4 : env vars scopées, wildcard TLS DNS-01, databases one-click, protection Caddy, certificats manuels, deploy hooks, rotation DB orchestrée, backups age+S3/R2 et restore.

Prérequis pour toutes les sections : `make infra-up && make dev`.

---

## 1. Env vars chiffrées & scopées

### Ajouter / éditer un secret

```
UI → /apps/$id/env → onglet [Prod | Preview | Dev | Shared]
     → « Add secret » → saisir KEY, VALUE, scope
     → Save
```

La valeur est chiffrée en AES-256-GCM avec la master key OS keyring avant persistance. Elle n'apparaît jamais en clair dans les logs.

CURL équivalent (dev) :

```bash
curl -s -X POST http://localhost:3335/apps/$APP_ID/secrets \
  -H "Content-Type: application/json" \
  -H "cookie: $COOKIE" \
  -H "x-csrf-token: $CSRF" \
  -d '{"key":"FOO","value":"bar","scope":"production"}'
```

### Reveal (afficher la valeur en clair)

```
UI → onglet env → icône « eye » sur la ligne → challenge passkey (ou TOTP)
```

Le GET brut de `/apps/$id/secrets` ne retourne jamais la valeur en clair — seule la route `/reveal` post-second-factor la décrypte.

### Import `.env`

```
UI → « Import .env file » → coller ou uploader le fichier
     → choisir le scope cible → Import
```

Format supporté : `KEY=VALUE` standard. Le préfixe `@scope:` (`@production:DATABASE_URL=...`) override le scope par ligne.

### Export chiffré

```bash
# Via UI → bouton « Export .env (encrypted) »
# Ou API :
curl -s http://localhost:3335/apps/$APP_ID/secrets/export \
  -H "cookie: $COOKIE" \
  -H "x-csrf-token: $CSRF" \
  > secrets-export.age
```

L'export est chiffré avec `age` — clé publique de l'utilisateur configurée dans les paramètres.

### Règle d'injection au runtime

| Type de deploy | Scopes injectés |
|---|---|
| `production` | `shared` + `production` (production gagne si conflit de clé) |
| `preview` (PR) | `shared` + `preview` |
| `development` | `shared` + `development` |

---

## 2. DNS-01 wildcard TLS par provider

Le DNS-01 est requis pour les wildcards (`*.monapp.com`) et les domaines sans accès HTTP direct (LAN, intranet). Caddy gère le challenge via le module DNS du provider concerné.

### Prérequis commun

1. Le token/clé API du provider est stocké comme secret chiffré dans Ploydok (scope `global_dns`).
2. L'enregistrement NS du domaine doit pointer vers le provider concerné.

---

### 2.1 Cloudflare

**Permissions requises** : Zone → DNS → Edit (scope limité au token, pas au compte global).

```bash
# Créer le token Cloudflare (API) :
curl -s -X POST https://api.cloudflare.com/client/v4/user/api_tokens \
  -H "Authorization: Bearer $CF_USER_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ploydok-dns01",
    "policies": [{
      "effect": "allow",
      "resources": {"com.cloudflare.api.account.zone.*": "*"},
      "permission_groups": [{"id": "4755a26aeef041e1816bc97f36e64d04"}]
    }]
  }'
```

Stocker le token dans Ploydok :

```
UI → Settings → DNS providers → Add Cloudflare
   → coller CF_API_TOKEN → Save
```

Debug TXT manuel si le challenge ne passe pas :

```bash
# Créer le record TXT manuellement pour diagnostiquer :
curl -s -X POST https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "TXT",
    "name": "_acme-challenge.monapp.com",
    "content": "<challenge-value>",
    "ttl": 60
  }'

# Vérifier la propagation :
dig TXT _acme-challenge.monapp.com @8.8.8.8
```

---

### 2.2 Route53 (AWS)

**Prérequis IAM** : policy minimale `route53:ChangeResourceRecordSets` + `route53:ListHostedZonesByName` + `route53:GetChange` sur la zone cible.

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "route53:ChangeResourceRecordSets",
      "route53:ListHostedZonesByName",
      "route53:GetChange"
    ],
    "Resource": "arn:aws:route53:::hostedzone/<ZONE_ID>"
  }]
}
```

Configurer dans Ploydok :

```
UI → Settings → DNS providers → Add Route53
   → AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION (us-east-1)
   → Save
```

Debug :

```bash
aws route53 change-resource-record-sets \
  --hosted-zone-id $ZONE_ID \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "_acme-challenge.monapp.com.",
        "Type": "TXT",
        "TTL": 60,
        "ResourceRecords": [{"Value": "\"<challenge>\""}]
      }
    }]
  }'
```

---

### 2.3 OVH

**Prérequis** : application OVH + consumer key avec droits `GET/POST/PUT/DELETE /domain/zone/*`.

```bash
# Créer la consumer key (flow OAuth OVH) :
curl -s -X POST https://eu.api.ovh.com/1.0/auth/credential \
  -H "X-Ovh-Application: $OVH_APP_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "accessRules": [
      {"method": "GET",    "path": "/domain/zone/*"},
      {"method": "POST",   "path": "/domain/zone/*"},
      {"method": "PUT",    "path": "/domain/zone/*"},
      {"method": "DELETE", "path": "/domain/zone/*"}
    ],
    "redirection": "https://localhost"
  }'
# → noter validationUrl, ouvrir dans le navigateur pour autoriser
```

Configurer dans Ploydok :

```
UI → Settings → DNS providers → Add OVH
   → OVH_APP_KEY + OVH_APP_SECRET + OVH_CONSUMER_KEY + OVH_ENDPOINT (ovh-eu)
```

Debug TXT manuel :

```bash
curl -s -X POST https://eu.api.ovh.com/1.0/domain/zone/monapp.com/record \
  -H "X-Ovh-Application: $OVH_APP_KEY" \
  -H "X-Ovh-Consumer: $OVH_CONSUMER_KEY" \
  -H "X-Ovh-Signature: $SIG" \
  -H "X-Ovh-Timestamp: $TS" \
  -d '{"fieldType":"TXT","subDomain":"_acme-challenge","target":"<challenge>","ttl":60}'
```

---

### 2.4 DigitalOcean

**Prérequis** : PAT (Personal Access Token) avec scope `write` sur les DNS.

```
UI → Settings → DNS providers → Add DigitalOcean
   → DO_AUTH_TOKEN (PAT)
```

Debug TXT manuel :

```bash
curl -s -X POST https://api.digitalocean.com/v2/domains/monapp.com/records \
  -H "Authorization: Bearer $DO_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "TXT",
    "name": "_acme-challenge",
    "data": "<challenge-value>",
    "ttl": 60
  }'

# Vérifier :
dig TXT _acme-challenge.monapp.com @ns1.digitalocean.com
```

---

## 3. DB one-click

### Créer une base

```
UI → /databases → « Create database »
   → Type : Postgres 16 | Redis 7 | MongoDB 7
   → Plan : small (512 MB RAM / 5 GB) | medium (1 GB / 20 GB) | large (2 GB / 50 GB)
   → Nom : my-db
   → Create
```

L'agent Rust spawn le container sur `ploydok-public`, avec un volume nommé `ploydok-db-<id>` pour la persistance.

Équivalent API :

```bash
curl -s -X POST http://localhost:3335/databases \
  -H "Content-Type: application/json" \
  -H "cookie: $COOKIE" \
  -H "x-csrf-token: $CSRF" \
  -d '{"name":"my-pg","projectId":"<id>","kind":"postgres","plan":"small"}'
```

### Lier une app à une DB (inject `DATABASE_URL`)

```
UI → /apps/$id/env → « Link database »
   → sélectionner la DB → Link
```

Les variables injectées selon le type :

| Type | Variables injectées |
|---|---|
| Postgres | `DATABASE_URL`, `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` |
| Redis | `REDIS_URL`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` |
| MongoDB | `MONGO_URL`, `MONGO_HOST`, `MONGO_PORT`, `MONGO_DB`, `MONGO_USER`, `MONGO_PASSWORD` |

API :

```bash
curl -s -X POST http://localhost:3335/apps/$APP_ID/link-database \
  -H "Content-Type: application/json" \
  -H "cookie: $COOKIE" \
  -H "x-csrf-token: $CSRF" \
  -d '{"databaseId":"<db-id>"}'
```

### Révéler la connection string

```
UI → /databases/$id → bouton « Reveal connection string »
   → challenge passkey
```

---

## 4. Protection Caddy par app

Trois middlewares activables indépendamment via `/apps/$id/protection`.

### 4.1 Basic Auth

```bash
curl -s -X PUT http://localhost:3335/apps/$APP_ID/protection \
  -H "Content-Type: application/json" \
  -H "cookie: $COOKIE" \
  -H "x-csrf-token: $CSRF" \
  -d '{"basic_auth_enabled": true, "basic_auth_user": "admin", "basic_auth_password": "secret"}'
```

Le mot de passe est stocké chiffré (AES-GCM) et bcrypt-hashé côté Caddy config. Vérification :

```bash
curl -I http://monapp.com/          # → 401 Unauthorized
curl -u admin:secret http://monapp.com/  # → 200 OK
```

Pour désactiver :

```bash
curl -s -X PUT http://localhost:3335/apps/$APP_ID/protection \
  -H "cookie: $COOKIE" -H "x-csrf-token: $CSRF" \
  -H "Content-Type: application/json" \
  -d '{"basic_auth_enabled": false}'
```

### 4.2 IP Allowlist

Format : liste CIDR séparés par virgule. Supporte IPv4 et IPv6.

```bash
curl -s -X PUT http://localhost:3335/apps/$APP_ID/protection \
  -H "Content-Type: application/json" \
  -H "cookie: $COOKIE" \
  -H "x-csrf-token: $CSRF" \
  -d '{"ip_allowlist_enabled": true, "ip_allowlist_cidrs": ["192.168.1.0/24", "10.0.0.0/8", "2001:db8::/32"]}'
```

Vérification (depuis un IP hors liste) :

```bash
curl -I http://monapp.com/   # → 403 Forbidden
```

### 4.3 Rate-limit

Limite en requêtes par seconde par IP (défaut : désactivé).

```bash
curl -s -X PUT http://localhost:3335/apps/$APP_ID/protection \
  -H "Content-Type: application/json" \
  -H "cookie: $COOKIE" \
  -H "x-csrf-token: $CSRF" \
  -d '{"rate_limit_enabled": true, "rate_limit_req_per_sec": 10}'
```

Note : nécessite le module `caddy-ratelimit` dans le Dockerfile Caddy custom (`xcaddy build`).

---

## 5. Certificat TLS manuel

### Uploader un certificat

```
UI → /apps/$id/domains → sélectionner un domaine → « Upload TLS cert »
   → coller cert.pem (chaîne complète : leaf + intermediaires)
   → coller key.pem
   → Save
```

Caddy servira ce cert à la place du ACME auto. La désactivation ACME est automatique pour ce domaine.

Validation avant upload :

```bash
# Vérifier la chaîne complète :
openssl verify -CAfile <(curl -s https://letsencrypt.org/certs/isrgrootx1.pem) cert.pem

# Vérifier que le cert matche la clé :
diff <(openssl x509 -pubkey -noout -in cert.pem) \
     <(openssl pkey -pubout -in key.pem)

# Vérifier le SAN :
openssl x509 -noout -ext subjectAltName -in cert.pem
```

API :

```bash
curl -s -X POST http://localhost:3335/apps/$APP_ID/domains/$DOMAIN_ID/tls/manual \
  -H "Content-Type: application/json" \
  -H "cookie: $COOKIE" \
  -H "x-csrf-token: $CSRF" \
  -d "{\"cert_pem\": $(cat cert.pem | jq -Rs .), \"key_pem\": $(cat key.pem | jq -Rs .)}"
```

### Alertes d'expiry

Le worker `cert-expiry-check` (cron journalier) envoie des notifications à J-30, J-7 et J-1 avant expiry. Visible dans le dashboard `/apps/$id/domains`.

---

## 6. Deploy hooks (pre/post)

### Configuration

```
UI → /apps/$id/settings → « Deploy hooks »
   → Pre-deploy command : prisma migrate deploy
   → Post-deploy command : node scripts/warm-cache.js
   → Timeout : 300 (s)
   → Save
```

API (PATCH app) :

```bash
curl -s -X PATCH http://localhost:3335/apps/$APP_ID \
  -H "Content-Type: application/json" \
  -H "cookie: $COOKIE" \
  -H "x-csrf-token: $CSRF" \
  -d '{
    "pre_deploy_hook": "prisma migrate deploy",
    "post_deploy_hook": "node scripts/warm-cache.js",
    "hooks_timeout_s": 300
  }'
```

### Comportement en cas d'échec

| Hook | Échec | Comportement |
|---|---|---|
| `pre_deploy` | exit code ≠ 0 | Deploy **abandonné**, `FatalDeployError` — l'ancien container reste live |
| `post_deploy` | exit code ≠ 0 | Build marqué `succeeded_with_warning`, alerte UI — le nouveau container est live |

Les logs des hooks apparaissent dans l'onglet **Builds** → build concerné → section « Hooks ».

### Exemples d'usage

```bash
# Migrations Prisma (pre_deploy) :
prisma migrate deploy

# Seed initial si table vide (pre_deploy) :
node -e "const p = require('./scripts/maybe-seed'); p.run().catch(process.exit)"

# Invalider le cache Redis post-deploy (post_deploy) :
redis-cli -u $REDIS_URL DEL app:cache:*

# Notification Slack post-deploy (post_deploy) :
curl -s -X POST $SLACK_WEBHOOK_URL \
  -d '{"text":"Deploy '"$APP_NAME"' successful"}'
```

---

## 7. Rotation DB orchestrée

### Flow complet (7 étapes)

```
Étape 1 — Génère new password 32 chars (entropy vérifiée)
Étape 2 — Agent : CREATE USER <user>_new GRANT ALL (Postgres)
              ou  ACL SETUSER <user>_new ON ~* &* +@all (Redis)
              ou  db.createUser(...) (Mongo)
Étape 3 — Store old password en password_history (TTL 24 h)
Étape 4 — Re-chiffre les secrets linked (nouvelle DATABASE_URL)
Étape 5 — Rolling redeploy blue-green pour chaque app linkée
           + double-write 5 min (ancien user toujours valide)
Étape 6 — Poll healthy 15 s × 20 itérations (5 min max)
         → OK : DROP USER <old> / ACL DELUSER / dropUser
         → Fail/timeout : ROLLBACK (restaure old password, re-redeploy apps)
Étape 7 — Dispatch notif db.rotated
```

### Déclencher une rotation manuelle

```
UI → /databases/$id → « Rotate password » (TOTP requis) → Confirm
```

API :

```bash
curl -s -X POST http://localhost:3335/databases/$DB_ID/rotate \
  -H "cookie: $COOKIE" \
  -H "x-csrf-token: $CSRF"
# Nécessite un cookie TOTP valide (second-factor)
```

### Commandes psql de debug post-rotation

```bash
# Se connecter directement au container Postgres :
docker exec -it ploydok-db-$DB_ID psql -U postgres

-- Lister les users actifs :
\du

-- Vérifier les droits de l'ancien et du nouveau user :
SELECT usename, usesuper, usecreatedb FROM pg_user WHERE usename LIKE '%ploydok%';

-- Si rotation bloquée (rotation_in_progress=true depuis > 10 min) :
-- Vérifier les connexions ouvertes sur l'ancien user :
SELECT pid, usename, application_name, state
FROM pg_stat_activity
WHERE usename = '<ancien_user>';

-- Forcer la terminaison des connexions bloquées :
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE usename = '<ancien_user>';
```

### Rollback manuel

Si la rotation est restée dans un état incohérent (crash de l'API pendant l'étape 5) :

```bash
# 1. Vérifier l'état en DB :
docker exec -it ploydok-postgres psql -U ploydok -d ploydok \
  -c "SELECT id, rotation_in_progress, last_rotation_error FROM databases WHERE id='$DB_ID';"

# 2. Débloquer manuellement si rotation_in_progress=true mais plus de job actif :
docker exec -it ploydok-postgres psql -U ploydok -d ploydok \
  -c "UPDATE databases SET rotation_in_progress=false WHERE id='$DB_ID';"

# 3. Restaurer le password depuis password_history si nécessaire :
docker exec -it ploydok-postgres psql -U ploydok -d ploydok \
  -c "SELECT encrypted_password, created_at FROM password_history WHERE database_id='$DB_ID' ORDER BY created_at DESC LIMIT 1;"
```

---

## 8. Backups S3/R2 + scheduler

### Prérequis : paire de clés age

```bash
# Installer age (si absent) :
apt install age        # Debian/Ubuntu
brew install age       # macOS

# Générer une paire de clés :
age-keygen -o ~/.age/key.txt
# → affiche la clé publique : age1xxxxxxxx...
# La clé privée est dans ~/.age/key.txt — la garder HORS du repo

# Afficher la clé publique :
age-keygen -y ~/.age/key.txt
```

La clé privée ne sera jamais envoyée au serveur. Le serveur ne voit que la clé publique (recipient).

### Configurer le stockage S3/R2

```
UI → /databases/$id → onglet « Backups » → « Configure backup »
   → Destination : S3 | R2 | Local
   → Endpoint : https://<account>.r2.cloudflarestorage.com  (R2)
                https://s3.amazonaws.com                    (AWS)
                http://127.0.0.1:9000                      (MinIO dev)
   → Bucket : ploydok-backups
   → Prefix : mydb/
   → Access Key / Secret Key (stockés comme secret chiffré)
   → Schedule : 0 3 * * * (03:00 UTC quotidien)
   → Retention : 7 (jours)
   → Age public key : age1xxxxxxxx...
   → Save
```

Vérifier le catalogue S3 après un backup :

```bash
aws s3 ls s3://ploydok-backups/mydb/ --endpoint-url $S3_ENDPOINT
# ou pour R2 :
aws s3 ls s3://ploydok-backups/mydb/ \
  --endpoint-url https://<account>.r2.cloudflarestorage.com \
  --profile r2
```

### Déclencher un backup immédiat

```
UI → /databases/$id → « Backup now »
```

API :

```bash
curl -s -X POST http://localhost:3335/databases/$DB_ID/backup-now \
  -H "cookie: $COOKIE" \
  -H "x-csrf-token: $CSRF"
```

### Vérifier l'état des backups

```bash
# Via API :
curl -s http://localhost:3335/databases/$DB_ID/backups \
  -H "cookie: $COOKIE" | jq '.backups[] | {id, status, size_bytes, created_at}'

# Via DB directement :
docker exec -it ploydok-postgres psql -U ploydok -d ploydok \
  -c "SELECT id, status, location, size_bytes, created_at FROM backups WHERE database_id='$DB_ID' ORDER BY created_at DESC LIMIT 10;"
```

---

## 9. Restore

### Prérequis

- Avoir la **clé privée age** correspondant à la clé publique utilisée lors du backup.
- TOTP actif sur le compte.
- La clé privée sera collée dans le navigateur et n'est jamais persistée côté serveur.

### Flow de restore

```
UI → /databases/$id → onglet Backups → sélectionner un backup → « Restore »
   → Modal : coller la clé privée age (champ password-masked)
   → Code TOTP
   → Confirm texte : "restore <nom_de_la_db>"
   → Start restore
   → Suivre la progression (SSE stream)
   → Healthcheck post-restore automatique
```

### Ce qui se passe côté serveur

1. Download du fichier `.age` depuis S3/local.
2. Déchiffrement via `age -d -i <private_key_tmpfile> <backup.age>`.
3. Pipe vers `docker exec <container> psql` (Postgres) / `redis-cli --pipe` (Redis) / `mongorestore` (Mongo).
4. La clé privée temporaire est détruite immédiatement après le déchiffrement.
5. Healthcheck : connexion + query simple (`SELECT 1` pour Postgres).
6. Notif `backup.restored` via le dispatcher.

---

## 10. Troubleshooting

| Erreur | Cause probable | Résolution |
|---|---|---|
| `DNS not propagated` / challenge ACME timeout | Le record TXT mis en place par Ploydok n'est pas encore visible | Attendre la propagation DNS (TTL 60 s minimum). Vérifier avec `dig TXT _acme-challenge.<domaine> @8.8.8.8`. Si absent après 5 min, vérifier les credentials du provider. |
| `ACME rate-limit` (Let's Encrypt 429) | Trop de certificats émis (>50/semaine/domaine) | Passer en staging ACME (`ACME_STAGING=1` dans env API) pour les tests. En prod, attendre le reset hebdomadaire. |
| `age binary missing` | L'agent ne trouve pas le binaire `age` dans le PATH du container | `apt-get install -y age` dans le Dockerfile de l'image DB custom, ou `which age` dans le container. |
| `S3 403 Forbidden` | Credentials incorrects ou bucket policy manquante | Vérifier les credentials stockés (reveal dans UI) + policy IAM `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` sur le bucket. |
| `rotation_in_progress` bloqué | L'API a crashé pendant la rotation (étape 5) | Voir §7 — Rollback manuel. |
| Caddy `rate_limit` module absent | L'image Caddy dev n'a pas le module `caddy-ratelimit` | Rebuilder Caddy avec `xcaddy build --with github.com/mholt/caddy-ratelimit` via `infra/caddy/Dockerfile`. |
| `cert_pem invalid` lors de l'upload | Chaîne de cert incomplète (manque intermediaire) | Concaténer leaf + intermediaire dans cert.pem. Valider avec `openssl verify`. |
| Restore échoue avec `unexpected EOF` | Le fichier age est corrompu ou la clé ne correspond pas | Vérifier que la clé publique configurée lors du backup correspond à la clé privée utilisée pour le restore (`age-keygen -y key.txt` affiche la clé publique). |
| `rotation_cooldown` 409 | Rotation lancée trop tôt (délai minimum entre deux rotations) | Attendre l'expiry du cooldown (affiché dans la réponse) ou vérifier la table `password_history`. |
| App non redéployée après rotation | Le rolling redeploy a échoué (healthcheck timeout) | Vérifier les logs du build de rotation dans `/apps/$id/builds`. Relancer un deploy manuel après diagnostic. |
| `backup.failed` sans message | Agent introuvable ou DB container arrêté | Vérifier que l'agent Rust tourne (`make dev-agent`) et que le container DB est up (`docker ps`). |
