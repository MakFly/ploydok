# Runbook — Sprint 3 : test e2e "100% réel" (`deploy-real.spec.ts`)

Ce runbook couvre le lancement du test bout-en-bout gated sur `PLOYDOK_E2E_REAL=1`.
Il vérifie : create app → clone → BuildKit → push registry → agent spawn → Caddy route → HTTP 200 + zero-downtime redeploy.

---

## Pré-requis host (3 shells)

```bash
# Shell 1 — infra (Caddy :8180/:8543, buildkitd, registry :5000)
make infra-up

# Shell 2 — agent Rust (socket /tmp/ploydok-agent.sock)
make dev-agent

# Shell 3 — stack applicative (API :3335 + Web :5173)
make dev
```

Vérifier que l'infra est up :

```bash
docker ps --filter name=ploydok
curl -s http://127.0.0.1:5000/v2/_catalog   # {"repositories":[...]}
curl -s http://127.0.0.1:2020/config/        # config Caddy JSON
```

---

## Installer la GitHub App Ploydok sur le compte cible

Le deploy worker utilise exclusivement des **installation tokens** GitHub App
(plus de PAT). Le repo fixture doit donc être accessible à une installation
de l'App Ploydok.

### 1. Créer l'App Ploydok (une fois par instance)

Via l'UI : `http://localhost:5173/settings/github` → *Create GitHub App*
(manifest flow). Cela persiste une row dans `github_app`.

### 2. Installer l'App sur le compte propriétaire du fixture

Depuis la même page → *Install* → choisir le compte/org qui possède
`ploydok/fixture-hello` → accorder l'accès à ce repo.

GitHub redirige vers `/github/app/setup?installation_id=<id>&setup_action=install`.
Noter l'`installation_id`.

### 3. Lier l'installation aux apps créées

Nouveau flow : `POST /apps` accepte `installationId` dans le body et le
stocke dans `apps.github_installation_id`.

Pour backfiller une app existante :

```bash
sqlite3 ploydok.db \
  "UPDATE apps SET github_installation_id='<installation_id>' WHERE id='<appId>';"
```

Fallback : si `github_installation_id` est `NULL`, `deploy.ts` scanne toutes
les installations et prend celle dont `account.login` matche le owner du
repo. C'est pratique en dev mais non-déterministe avec plusieurs orgs.

---

## Fixture repo `ploydok/fixture-hello`

Le test s'appuie sur un repo public GitHub. Structure minimale :

### `Dockerfile`

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY server.mjs .
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.mjs"]
```

### `server.mjs`

```js
import { createServer } from "node:http"
const PORT = process.env.PORT ?? 3000
createServer((_, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" })
  res.end("hello from ploydok\n")
}).listen(PORT, "0.0.0.0", () => {
  console.log(`listening on ${PORT}`)
})
```

### Recréer le repo si perdu

```bash
mkdir fixture-hello && cd fixture-hello
git init
# créer Dockerfile + server.mjs (contenus ci-dessus)
git add . && git commit -m "feat: fixture hello server"
gh repo create ploydok/fixture-hello --public --push --source=.
```

---

## Variables d'environnement requises

| Variable | Valeur par défaut | Description |
|---|---|---|
| `PLOYDOK_E2E_REAL` | _(absent → skip)_ | Positionner à `"1"` pour activer le test |
| `E2E_TEST_EMAIL` | — | Email du compte de test (backup-code login) |
| `E2E_TEST_BACKUP_CODE` | — | Code backup au format `XXXX-XXXX-XXXX` |
| `E2E_API_URL` | `http://localhost:3335` | URL de l'API |
| `PLOYDOK_DOMAIN_BASE` | `demo.ploydok.local` | Base de domaine Caddy |

---

## Run

```bash
PLOYDOK_E2E_REAL=1 \
  E2E_TEST_EMAIL=you@example.com \
  E2E_TEST_BACKUP_CODE=XXXX-XXXX-XXXX \
  bun --cwd apps/web exec playwright test deploy-real.spec.ts --reporter=list
```

Pour voir le navigateur (debug visuel) :

```bash
PLOYDOK_E2E_REAL=1 \
  E2E_TEST_EMAIL=you@example.com \
  E2E_TEST_BACKUP_CODE=XXXX-XXXX-XXXX \
  bun --cwd apps/web exec playwright test deploy-real.spec.ts --headed
```

---

## Debug

```bash
# Logs API (en temps réel dans le Shell 3)
# make dev inclut les logs pino structurés

# Logs agent Rust
make dev-agent   # logs tracing dans le Shell 2

# Config Caddy (routes dynamiques injectées par le worker)
curl -s http://127.0.0.1:2020/config/ | jq .

# Registry — vérifier que l'image a bien été poussée
curl -s http://127.0.0.1:5000/v2/_catalog
curl -s http://127.0.0.1:5000/v2/app-<appId>/tags/list

# DB — état des builds
sqlite3 ploydok.db "SELECT id, status, error_message FROM builds ORDER BY created_at DESC LIMIT 5;"
```

---

## Résultats attendus

| Étape | Délai |
|---|---|
| Build #1 (clone + BuildKit + push) | ~60 s |
| HTTP 200 sur le domaine live | < 120 s depuis `POST /apps` |
| Build #2 (redeploy) zéro-downtime | < 180 s, 0 réponse ≥ 500 |

Si `builds[0].status === "failed"` → lire `error_message` dans la DB ou via :

```bash
curl -s http://localhost:3335/apps/<appId> \
  -H "cookie: ploydok_access=<token>" | jq .builds[0]
```

---

## Cleanup post-test

Le spec ne détruit pas l'app en fin de run (la DB reste propre pour inspecter
les builds). Pour arrêter l'app manuellement :

```bash
curl -s -X POST http://localhost:3335/apps/<appId>/stop \
  -H "cookie: ploydok_access=<token>" \
  -H "x-csrf-token: <csrf>"
```
