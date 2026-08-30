-- How a reader gets their brief: email, a PDF on a connected drive, or both.
--
-- Filing to a drive (GOI-91) was an *addition* to the email — everyone was
-- mailed, and a connected drive also got a copy. There was no way to say "file
-- it and don't mail me", which is what someone who reads the brief off their
-- phone's drive app actually wants.
--
-- The backfill preserves today's behaviour exactly rather than defaulting
-- everyone to the column default: a config whose owner has a drive connected
-- was already getting both, so it says `both`; everyone else says `email`.
-- Defaulting those users to `email` would silently switch off a filed copy
-- they are already receiving.
--
-- Idempotent: migrate.ts re-runs every file on every deploy. The backfill is
-- guarded on the column being new, so a reader who later chooses `email` while
-- keeping a drive connected is not switched back to `both` on the next deploy.

DO $$
DECLARE
  is_new boolean;
BEGIN
  is_new := NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'newsletter_subscriptions' AND column_name = 'delivery'
  );

  ALTER TABLE "newsletter_subscriptions"
    ADD COLUMN IF NOT EXISTS "delivery" text NOT NULL DEFAULT 'email';

  IF is_new THEN
    UPDATE "newsletter_subscriptions" s
    SET "delivery" = 'both'
    WHERE EXISTS (
      SELECT 1 FROM "drive_connections" d WHERE d."user_id" = s."user_id"
    );
  END IF;
END $$;
