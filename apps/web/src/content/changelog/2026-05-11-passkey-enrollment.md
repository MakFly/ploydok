# Enrôlement passkey depuis les settings

La page Security > Passkeys permet maintenant d'ajouter une passkey depuis l'application.

## Ce qui change

- Un formulaire `Add passkey` est disponible au-dessus de la liste des devices.
- L'utilisateur peut nommer le device avant de lancer la cérémonie WebAuthn.
- La liste des passkeys et le profil `/me` sont rafraîchis après l'enrôlement.
- Si le navigateur ou l'origin ne supporte pas WebAuthn, l'UI affiche la raison au lieu de laisser l'utilisateur bloqué.

## Garde-fous

- Les endpoints d'enrôlement passkey exigent maintenant une session authentifiée.
- `/auth/register/verify` refuse explicitement d'enrôler une passkey pour un autre utilisateur.
- Les appels `/auth/register/*` peuvent désormais bénéficier du refresh de session automatique côté frontend.

## Note de déploiement

Les passkeys nécessitent une origin HTTPS compatible WebAuthn. Une instance ouverte en HTTP sur une IP brute ne peut pas créer de passkey côté navigateur.
