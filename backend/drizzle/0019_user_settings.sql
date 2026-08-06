-- GOI-49: per-user preferences. Today that is only the share-button wording,
-- but the table is the place the next one goes rather than another column on
-- `users`.
--
-- A missing row means "all defaults", so there is nothing to backfill.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS "user_settings" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "share_text" text,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
