-- Fail loudly before adding functional indexes: silently choosing one account
-- or invitation would make identity ownership ambiguous.
-- Expired pending invitations are no longer actionable and must not reserve the
-- unique active-invitation slot introduced below.
DELETE FROM membership_invitations
WHERE accepted_at IS NULL AND expires_at <= now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM users GROUP BY lower(btrim(email)) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'cannot enforce case-insensitive users email uniqueness: collisions exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM membership_invitations
    WHERE accepted_at IS NULL
    GROUP BY org_id, lower(btrim(email))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'cannot enforce pending invitation uniqueness: collisions exist';
  END IF;

  IF EXISTS (
    SELECT 1 FROM membership_invitations GROUP BY token_hash HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'cannot enforce invitation token uniqueness: collisions exist';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique
  ON users (lower(btrim(email)));

CREATE UNIQUE INDEX IF NOT EXISTS membership_invitations_pending_org_email_unique
  ON membership_invitations (org_id, lower(btrim(email)))
  WHERE accepted_at IS NULL;

DROP INDEX IF EXISTS membership_invitations_token_hash_idx;
CREATE UNIQUE INDEX IF NOT EXISTS membership_invitations_token_hash_unique
  ON membership_invitations (token_hash);
