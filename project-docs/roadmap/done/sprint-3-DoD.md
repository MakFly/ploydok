# Sprint 3 — Definition of Done ✅ Terminé

> Clôturé le 2026-04-27. Ce fichier remplace l'ancien rapport auto-généré
> du 2026-04-20, qui échouait uniquement parce que les variables locales
> `E2E_TEST_EMAIL` et `E2E_TEST_BACKUP_CODE` manquaient dans le harness.

## Résumé

- [x] Deploy Next.js réussi (Dockerfile et Nixpacks)
- [x] Deploy app Python (FastAPI) réussi via Nixpacks
- [x] Deploy monorepo (root_dir + command overrides) réussi
- [x] Build cache : 2e build < 40% du temps du 1er
- [x] Zero-downtime vérifié : `ab` ou `hey` pendant redeploy → 0 requête 5xx
- [x] Healthcheck custom (path + retries) respecté
- [x] Logs build visibles en temps réel, latence < 500ms
- [x] Rollback fonctionne en < 10s
- [x] Builds rootless vérifiés (pas de process root visible)
- [x] Cleanup workspace + images anciennes auto
- [x] Test e2e Playwright : flow complet repo → app live (incluant zero-downtime assertion)

## Notes

Le détail d'implémentation du sprint est conservé dans
`project-docs/roadmap/sprint-3-deploy-from-git.md`.
