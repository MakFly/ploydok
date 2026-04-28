# RAF — Webhook auto-deploy en dev local

> Créé 2026-04-21 suite au test Wave 3 sprint 3.1.1.
> **Blocker UX dev** : aujourd'hui, impossible de tester le flow `git push → auto-deploy` sans setup tunnel externe.

## État actuel

- API Hono écoute sur `http://localhost:3335/github/webhook` (idem `/gitlab/webhook`).
- GitHub/GitLab ne peuvent pas atteindre `localhost` depuis leurs serveurs (NAT, CGNAT, IP dynamique, firewall).
- **Conséquence** : pour tester l'auto-deploy en dev, le dev doit lui-même installer et lancer un tunnel externe (cloudflared, ngrok, smee.io…) + mettre à jour la GitHub App à chaque session.
- Aucune automatisation côté Ploydok pour cette étape.

## Pourquoi c'est un RAF

Le `make dev` lance l'API + la Web. Il **ne lance pas** de tunnel. Le dev :

1. Doit connaître la contrainte (aujourd'hui, uniquement dans la doc `docs/runbooks/` future + CR sprint).
2. Doit choisir un tunnel + l'installer.
3. Doit reconfigurer la GitHub App manuellement (URL webhook change à chaque relance avec les tunnels gratuits quick).
4. Doit resynchroniser le webhook secret si régénéré.

Friction importante pour un onboarding contributeur ou un test rapide de la feature.

## Options d'amélioration (à prioriser post-3.1.1)

### Option 1 — Intégrer cloudflared dans `make dev` (simple, gratuit)
- Ajouter une cible `make dev-tunnel` qui lance `cloudflared tunnel --url http://localhost:3335` en background.
- Parse l'URL `trycloudflare.com` émise par cloudflared (stderr) → écrit dans `apps/api/.env.local.tunnel` (gitignored) sous `PLOYDOK_TUNNEL_URL`.
- API lit cette var au boot et la renvoie via `/me/debug/tunnel` pour que l'UI l'affiche dans un bandeau "Dev tunnel : https://xxx.trycloudflare.com → configure ton webhook ici".
- Prérequis : `cloudflared` installé sur la machine dev (documenté dans `.claude/rules/commands.md`).
- **Limitation** : URL change à chaque redémarrage du tunnel → le dev doit re-update la GitHub App manuellement.

### Option 2 — smee.io proxy (URL stable, gratuit)
- Intégrer le forwarder `smee-client` comme service du workspace.
- Au premier `make dev`, générer une URL Smee stable et la persister dans `apps/api/.env.local` (`SMEE_URL`).
- Script qui lance `smee-client` forwarder vers `localhost:3335/github/webhook` + `/gitlab/webhook` (ou sur 2 instances).
- Afficher dans l'UI "Dev webhook proxy : https://smee.io/<url>".
- **Avantage** : URL persistante, setup GitHub App une seule fois pour tous les dev futurs du même clone.
- **Limitation** : dépendance externe sur smee.io (propriété Probot — service GitHub, stable mais pas notre contrôle).

### Option 3 — Caddy en mode tunnel inbound via Cloudflare Tunnel nommé
- Utiliser `cloudflared tunnel create ploydok-dev` + credentials JSON commités dans un secret.
- DNS CNAME stable `dev-<user>.ploydok.dev` pointant sur le tunnel.
- Le tunnel route `dev-<user>.ploydok.dev/github/webhook` → `localhost:3335`.
- **Avantage** : URL stable nominative par contributeur, HTTPS géré par Cloudflare.
- **Limitation** : requires un compte Cloudflare + zone DNS gérée par Ploydok. Setup non-trivial pour un nouveau contributeur.

### Option 4 — Playwright scenario avec payload simulé (tests uniquement)
- Pour les tests e2e (Wave 6 sprint 3.1.1), pas besoin de vrai GitHub : simuler le POST `/github/webhook` avec un payload fixture + signature HMAC calculée localement.
- **Déjà prévu** dans `scripts/test-webhook-e2e.sh` du plan sprint 3.1.1 Wave 6.
- **Ne résout pas** le besoin de test manuel avec un vrai repo GitHub.

### Option 5 — Documenter l'état actuel dans un runbook (minimum viable)
- Créer `docs/runbooks/webhook-autodeploy-local-dev.md` avec les 3 options tunnel (cloudflared, ngrok, smee), step-by-step + troubleshooting.
- **Déjà prévu** dans la DoD sprint 3.1.1 Wave 6 (`docs/runbooks/webhook-autodeploy.md`).
- **Ne résout pas** la friction — documente juste le contournement.

## Recommandation

- **Court terme** (sprint 3.1.1 Wave 6) : option 5 (runbook), on livre 3.1.1 sans bloquer.
- **Moyen terme** (sprint 4 ou post-3.1.1 cleanup) : option 2 (smee intégré au `make dev` sous flag `PLOYDOK_DEV_WEBHOOK_PROXY=smee`). Zéro dépendance sur le laptop dev (hors Node/Bun), URL stable.
- **Long terme** (sprint 6, install script) : en prod publique (domaine Ploydok self-hosted), zéro tunnel — DNS pointe direct sur Caddy. Problème disparaît pour les users finaux. Le RAF reste uniquement pour les **contributeurs dev** du repo.

## Décision à prendre

- [ ] Quelle option retenir à moyen terme ? (2 recommandé)
- [ ] Est-ce qu'on accepte une dépendance smee.io (service externe tiers non contrôlé) dans le dev loop ?
- [ ] Alternative : livrer nous-mêmes un micro-proxy TypeScript dans `packages/dev-webhook-proxy/` qui écoute sur un port public via Cloudflare Tunnel nommé Ploydok (option 3 mais mutualisée) ?

## Références

- Sprint 3.1.1 : `docs/sprints/sprint-3.1.1-webhook-autodeploy.md`
- Plan : `docs/plans/PLAN-sprint-3.1.1.md` (Wave 6 inclut runbook webhook)
- Handler webhook actuel : `apps/api/src/routes/github.ts:504`, `apps/api/src/routes/gitlab.ts:314`

## Liens smee.io / cloudflared (référence)

- `https://smee.io/` — génère une URL webhook stable, Node client forwarder
- `https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/` — tunnels nommés
- `https://ngrok.com/docs/http/` — alternative payante URL stable

---

**Statut** : 🔴 À adresser — bloque l'UX de test auto-deploy pour tout contributeur n'ayant pas déjà un tunnel configuré.
