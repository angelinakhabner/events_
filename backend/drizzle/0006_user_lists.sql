-- User lists: a parent grouping over a user's venue subscriptions (e.g. a
-- "Warsaw" list and a "Poznan" list). Exactly one list is active per user;
-- the scheduler only scrapes venues reachable through an active list (or
-- venues nobody subscribes to — the shared seed powering the public home).
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS "user_lists" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("user_id", "name")
);
CREATE INDEX IF NOT EXISTS "user_lists_user_id_idx" ON "user_lists" ("user_id");

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS
  "active_list_id" uuid REFERENCES "user_lists"("id") ON DELETE SET NULL;

ALTER TABLE "user_venues" ADD COLUMN IF NOT EXISTS
  "list_id" uuid REFERENCES "user_lists"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "user_venues_list_id_idx" ON "user_venues" ("list_id");

-- Backfill: every user with subscriptions gets a default "Warsaw" list, their
-- existing subscriptions move into it, and it becomes their active list.
INSERT INTO "user_lists" ("user_id", "name")
SELECT DISTINCT uv."user_id", 'Warsaw' FROM "user_venues" uv
ON CONFLICT ("user_id", "name") DO NOTHING;

UPDATE "user_venues" uv
SET "list_id" = ul."id"
FROM "user_lists" ul
WHERE ul."user_id" = uv."user_id" AND ul."name" = 'Warsaw' AND uv."list_id" IS NULL;

-- Oldest list wins so re-runs (migrations are re-applied on deploy) stay
-- deterministic for any user whose active list was deleted in the meantime.
UPDATE "users" u
SET "active_list_id" = ul."id"
FROM (
  SELECT DISTINCT ON ("user_id") "id", "user_id"
  FROM "user_lists" ORDER BY "user_id", "created_at" ASC
) ul
WHERE ul."user_id" = u."id" AND u."active_list_id" IS NULL;
