-- Repair installations where the JOB-04 saga table predates actor tracking.
ALTER TABLE resource_creation_sagas
  ADD COLUMN IF NOT EXISTS requested_by_user_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'resource_creation_sagas_requested_by_user_id_users_id_fk'
      AND conrelid = 'resource_creation_sagas'::regclass
  ) THEN
    ALTER TABLE resource_creation_sagas
      ADD CONSTRAINT resource_creation_sagas_requested_by_user_id_users_id_fk
      FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;
