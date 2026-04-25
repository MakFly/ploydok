# Sprint 5 — Copilot IA (read-only) ⏸️ Standby

> **Statut : en standby.** Décision 2026-04-25 — le copilote IA est repoussé après v1.0 pour prioriser hardening, storage S3 et parité Sprint 7. Aucune implémentation de ce sprint ne doit démarrer sans relancer explicitement le scope.

**Durée** : 1 semaine
**Objectif** : intégrer le différenciateur produit — un copilote IA capable de diagnostiquer et répondre en langage naturel, sans exécuter d'action destructive.
**Dépendances** : Sprints 1-4 terminés (besoin d'apps réelles, logs, stats pour que le copilote ait du contexte utile).

---

## Scope

Le copilot v1 est **read-only**. Il peut lire logs, stats, états, et générer du contenu (Dockerfile, configs). Aucun tool write. Les actions destructives sont repoussées au Sprint 7 (v1.5).

---

## Tâches détaillées

### 5.1 Intégration Anthropic SDK

- Install `@anthropic-ai/sdk` dans `apps/api`
- Modèle principal : `claude-sonnet-4-6`
- Modèle fallback simple Q&A : `claude-haiku-4-5-20251001`
- API key utilisateur stockée en secret chiffré (paramétré par admin instance)
- Prompt caching activé sur le system prompt + liste apps (économise ~90% coûts)

### 5.2 Tools schemas (read-only)

Définir dans `packages/shared/copilot-tools.ts` :

- `listApps()` → `[{ id, name, status, domain }]`
- `getAppStatus(app_id)` → `{ status, uptime, last_deploy, health }`
- `getLogs(app_id, since, filter?)` → `string[]` (max 500 lignes, secrets redactés)
- `getStats(app_id, range)` → `{ cpu: [...], mem: [...] }`
- `listDatabases()` → idem apps
- `explainError(text)` → pure raisonnement LLM
- `generateDockerfile(stack_description)` → string
- `generateCompose(services_description)` → string
- `searchAuditLog(query, since)` → `AuditEntry[]`

Chaque tool a un schéma JSON strict, validé par zod côté API.

### 5.3 Orchestration conversation

- Endpoint `POST /copilot/chat` avec stream SSE
- Boucle tool-use :
  1. Envoi message user + historique + tools
  2. Si `tool_use` → exécuter, injecter résultat, rappeler LLM
  3. Limite : 8 tool calls par tour (évite boucles)
- Stockage conversation : table `copilot_conversations` + `copilot_messages` (chiffrés at-rest)
- Rétention : 30 jours, purge auto

### 5.4 Context injection

- System prompt dynamique :
  - Instance ID + version
  - Liste apps + DBs du user (via RAG léger, pas embeddings v1)
  - 20 derniers events audit log
  - Conventions (nommage containers, réseau, etc.)
- Tout ce contexte = cacheable (prompt caching Anthropic)

### 5.5 Redaction secrets

- Avant envoi au LLM, regex pass sur logs/outputs :
  - Patterns : `password=`, `token=`, `BEGIN PRIVATE KEY`, URLs avec creds, JWT
  - Remplacement : `<REDACTED>`
- Liste dynamique : tous les secrets connus du user sont hashés, match par hash → redaction
- Tests unitaires avec 30 patterns réalistes

### 5.6 UI chat

- Route `/copilot` + widget flottant accessible depuis chaque page app
- Composant `ChatPanel` (shadcn + markdown renderer)
- Streaming token par token
- Affichage tool calls : accordéons repliables avec input/output
- Prompts suggérés contextualisés :
  - Sur `/apps/:id` → « Pourquoi cette app crash ? », « Montre logs erreur 1h »
  - Sur `/dashboard` → « Quelles apps ont des soucis ? », « Résumé santé générale »

### 5.7 Garde-fous v1

- Aucun tool write exposé, code review bloque toute PR qui en ajoute sans passer Sprint 7
- Rate-limit : 50 messages/heure/user
- Coût tracking : table `copilot_usage` (tokens in/out, coût estimé)
- Alerte admin si un user dépasse seuil configurable

### 5.8 Tests qualité

- Dataset interne 30 questions typiques :
  - 10 diagnostic (logs d'erreurs réels anonymisés)
  - 10 génération (Dockerfile, compose, .env.example)
  - 10 Q&A système (stats, audit)
- Évaluation manuelle : taux réponses « utiles » cible > 80%

---

## Deliverable démo

1. Push une app volontairement cassée (OOM killer sur Node)
2. Ouvrir copilot, demander : « Pourquoi `api-broken` redémarre en boucle ? »
3. Copilot appelle `getLogs`, `getStats`, `getAppStatus`
4. Diagnostic : « OOM à cause de heap limite Node, je recommande `--max-old-space-size=1024` ou bump RAM à 2 Go »
5. Ask: « Génère moi le Dockerfile corrigé » → output propre

---

## Definition of Done

- [ ] 9 tools implémentés + schémas zod
- [ ] Streaming SSE fonctionne (pas de buffering)
- [ ] Redaction secrets : 30/30 patterns test passent
- [ ] Prompt caching actif (vérifié via logs Anthropic : `cache_read_input_tokens` > 0)
- [ ] Rate-limit actif
- [ ] UI chat responsive, markdown + code blocks bien rendus
- [ ] Dataset qualité : ≥ 24/30 réponses jugées utiles
- [ ] Aucun tool write dans le code (grep `tool_use.*write` vide)

---

## Risques sprint

| Risque                          | Mitigation                                                                |
| ------------------------------- | ------------------------------------------------------------------------- |
| Coûts LLM explosent             | Prompt caching + rate-limit + modèle Haiku pour Q&A simples               |
| Leak secret dans réponse LLM    | Redaction + revue manuelle + tests 30 patterns                            |
| Hallucinations sur état système | Tools réels obligatoires, system prompt interdit réponses sans tool check |
| Latence ressentie > 5s          | Streaming visible dès le premier token, loader pendant tool calls         |
