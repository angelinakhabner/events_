-- A newsletter's API key (GOI-152): lets an outside service such as
-- printed.sh fetch that one newsletter's latest issue as a PDF or JSON.
-- One key per newsletter; only its SHA-256 is kept.
--
-- Idempotent: migrate.ts re-runs every file on every deploy.

CREATE TABLE IF NOT EXISTS "newsletter_api_keys" (
  "config_id" uuid PRIMARY KEY REFERENCES "newsletter_subscriptions"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "key_hash" text NOT NULL UNIQUE,
  "last_four" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_used_at" timestamp with time zone
);
