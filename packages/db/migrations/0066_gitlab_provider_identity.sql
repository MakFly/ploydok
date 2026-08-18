-- A project may be visible through several provider installations/users. Its
-- provider id is only unique inside that installation cache.
ALTER TABLE provider_repos DROP CONSTRAINT IF EXISTS provider_repos_pkey;
ALTER TABLE provider_repos
  ADD CONSTRAINT provider_repos_pkey PRIMARY KEY (installation_id, id);

ALTER TABLE apps
  ADD COLUMN IF NOT EXISTS git_provider_installation_id text,
  ADD COLUMN IF NOT EXISTS gitlab_credential_user_id text;

UPDATE apps AS app
SET git_provider_installation_id = 'github:' || app.github_installation_id
WHERE app.git_provider = 'github'
  AND app.github_installation_id IS NOT NULL
  AND app.git_provider_installation_id IS NULL;

UPDATE apps AS app
SET git_provider_installation_id = 'gitlab:user:' || project.owner_id,
    gitlab_credential_user_id = project.owner_id
FROM projects AS project
WHERE app.project_id = project.id
  AND app.git_provider = 'gitlab'
  AND app.git_provider_installation_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_apps_provider_installation
  ON apps (git_provider, git_provider_installation_id);
