# Dashboard monitoring workspace

Le dashboard affiche maintenant un résumé runtime orienté produit au lieu d'exposer directement des compteurs Docker bruts.

## Ce qui change

- La card `Runtime` devient `Services`.
- Le compteur principal représente les ressources runtime actives du workspace courant.
- Le détail affiche les apps, databases et incidents runtime plutôt que `containers tracked`.
- Les données du dashboard utilisent maintenant le monitoring scoped workspace.

## Monitoring

La page Monitoring reste l'endroit prévu pour inspecter le détail technique : status, CPU, mémoire, uptime, restarts, image et healthcheck des runtimes app/database.

Les libellés de cette page parlent maintenant de runtimes plutôt que de containers quand l'information est destinée au workspace.
