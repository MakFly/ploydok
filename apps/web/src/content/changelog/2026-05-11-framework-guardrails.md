# Framework guardrails génériques

Ploydok applique maintenant des garde-fous framework avant le premier deploy, lors de l'import `.env`, et au moment des deploys prod/preview. L'objectif est simple : éviter les 502 causés par des defaults framework incomplets ou dangereux.

## Ce qui change

- Laravel génère ou répare `APP_KEY`, force des drivers `file` quand aucune base externe n'est détectée, et injecte des defaults runtime sûrs.
- Symfony reçoit `APP_SECRET`, `APP_ENV=prod` et `APP_DEBUG=0` automatiquement quand ces valeurs manquent ou sont vides.
- Rails et Phoenix réparent `SECRET_KEY_BASE` quand le projet en a besoin.
- Next.js, Hono et Node reçoivent des defaults Node 22 et host adaptés aux containers.
- Python reçoit `PYTHONUNBUFFERED=1` et des ports runtime cohérents selon Django, Flask ou FastAPI.
- Dockerfile et Compose restent user-managed : Ploydok signale les risques, mais ne réécrit pas l'intention du projet.

## Détection

La classification ne se limite plus aux fichiers présents. Ploydok lit aussi des manifests sûrs comme `package.json`, `composer.json`, `composer.lock`, `Gemfile`, `mix.exs`, `pom.xml`, `build.gradle`, `requirements.txt` et `pyproject.toml`.

Cela permet de détecter Hono via dépendance npm, Symfony/Laravel via Composer, Rails via Gemfile, Phoenix via Mix, et Spring Boot via Maven ou Gradle.

## Deploy

Les mêmes garde-fous tournent à la création d'app, à l'import `.env`, au deploy prod et au deploy preview. Les valeurs explicitement définies par l'utilisateur sont conservées, sauf quand elles sont vides ou connues comme cassantes.

## Validation

Les tests couvrent la classification, les réparations d'environnement, l'import `.env`, les routes GitHub/GitLab de manifests, les previews et les typechecks API/web/shared.
