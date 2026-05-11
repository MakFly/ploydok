# Runtime Swarm, scaling et rollouts propres

Ploydok peut exécuter les apps via Docker Swarm services. Ce mode apporte le scaling par replicas, les updates `start-first`, le rollback automatique et un chemin CI/CD plus propre pour mettre à jour le VPS.

## Scaling

Le scaling se configure par application dans les settings Build & runtime. Une app Swarm garde un nombre cible de tasks, et Docker répartit le trafic entre les replicas disponibles.

Les apps avec volumes locaux écrits restent limitées à un replica tant qu'un stockage partagé n'est pas configuré.

## Updates sans interruption

Les services Swarm utilisent `start-first` par défaut. Swarm démarre la nouvelle task avant d'arrêter l'ancienne, puis surveille la stabilisation du service.

Si la nouvelle version ne devient pas saine, l'update peut rollback au lieu de laisser Caddy pointer vers un runtime cassé.

## CI/CD

La CI publie les images. Le serveur les récupère ensuite proprement via le mécanisme de rollout prévu, au lieu de remplacer des containers à la main en SSH.

Ploydok envoie maintenant la spec Swarm complète pendant les updates d'image afin de conserver les paramètres importants : replicas, networks, env, healthcheck, update order et policy de rollback.

## Storage hygiene

Le nettoyage d'images fait partie du cycle de vie : les anciennes images remplacées et les caches de build/registry sont nettoyés pour éviter une croissance continue du disque.

## Monitoring

Le monitoring resynchronise l'état app depuis les containers réellement actifs. Si un container tourne, Ploydok remet l'app en `running` et actualise le `container_id`, ce qui évite les breadcrumbs ou badges stale.
