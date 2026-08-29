-- GOI-100: split the send schedule from the category cadence.
--
-- The old shape had one `frequency` per category and no separate notion of
-- when an email actually leaves, so "cinema daily, museums weekly" described
-- three sections and no send rhythm — the scheduler inferred one from the
-- busiest section. It also had a single global `after_hour`, which silently
-- emptied every museum section: exhibitions are daytime, so "only after 18:00"
-- meant a museums block that could never match anything.
--
-- This migration keeps `newsletter_subscriptions` and its rows rather than
-- starting a fresh table, so every existing subscription carries forward with
-- its email, schedule and send history. What changes is the key (one row per
-- user becomes one row per user per folder), the addition of the envelope
-- columns, and the move of `category_rules` out of JSONB into a child table.
--
-- Idempotent: migrate.ts re-runs every file on every deploy.

-- ── 1. The config gets its own identity ─────────────────────────────────────
ALTER TABLE "newsletter_subscriptions" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
UPDATE "newsletter_subscriptions" SET "id" = gen_random_uuid() WHERE "id" IS NULL;
ALTER TABLE "newsletter_subscriptions" ALTER COLUMN "id" SET NOT NULL;

DO $$
BEGIN
  -- user_id was the primary key. It becomes an ordinary indexed column, since
  -- a reader may now hold one newsletter per folder.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'newsletter_subscriptions_pkey'
      AND conrelid = 'newsletter_subscriptions'::regclass
      AND pg_get_constraintdef(oid) LIKE '%user_id%'
  ) THEN
    ALTER TABLE "newsletter_subscriptions" DROP CONSTRAINT "newsletter_subscriptions_pkey";
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'newsletter_subscriptions_pkey'
      AND conrelid = 'newsletter_subscriptions'::regclass
  ) THEN
    ALTER TABLE "newsletter_subscriptions" ADD PRIMARY KEY ("id");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "newsletter_subscriptions_user_id_idx"
  ON "newsletter_subscriptions" ("user_id");

-- ── 2. The envelope ─────────────────────────────────────────────────────────
ALTER TABLE "newsletter_subscriptions"
  ADD COLUMN IF NOT EXISTS "folder_id" uuid REFERENCES "user_lists"("id") ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS "name" text NOT NULL DEFAULT 'Newsletter',
  ADD COLUMN IF NOT EXISTS "send_cadence" text NOT NULL DEFAULT 'weekly',
  ADD COLUMN IF NOT EXISTS "send_day_of_month" smallint,
  ADD COLUMN IF NOT EXISTS "timezone" text NOT NULL DEFAULT 'Europe/Warsaw',
  ADD COLUMN IF NOT EXISTS "suppress_empty_issues" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "want_to_go" jsonb NOT NULL
    DEFAULT '{"enabled":true,"horizonDays":7,"changesEnabled":true,"urgentSend":true}'::jsonb,
  ADD COLUMN IF NOT EXISTS "last_urgent_at" timestamptz;

-- The old per-subscription `frequency` *was* the send cadence in everything
-- but name; carry it across rather than defaulting everyone to weekly.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'newsletter_subscriptions' AND column_name = 'frequency'
  ) THEN
    UPDATE "newsletter_subscriptions" SET "send_cadence" = "frequency"
    WHERE "frequency" IN ('daily', 'weekly', 'monthly');
  END IF;
END $$;

-- send_weekday is only meaningful for a weekly newsletter, and send_day_of_month
-- only for a monthly one. Storing a value that does nothing is how a later
-- reader comes to believe it means something.
ALTER TABLE "newsletter_subscriptions" ALTER COLUMN "send_weekday" DROP NOT NULL;
ALTER TABLE "newsletter_subscriptions" ALTER COLUMN "send_weekday" DROP DEFAULT;
UPDATE "newsletter_subscriptions" SET "send_weekday" = NULL WHERE "send_cadence" <> 'weekly';
UPDATE "newsletter_subscriptions" SET "send_day_of_month" = 1
  WHERE "send_cadence" = 'monthly' AND "send_day_of_month" IS NULL;

-- One newsletter per folder. Two indexes rather than one constraint because
-- NULL never equals NULL in SQL: without the second, a reader could hold any
-- number of folderless configs and the app would pick one arbitrarily.
CREATE UNIQUE INDEX IF NOT EXISTS "newsletter_subscriptions_user_folder_key"
  ON "newsletter_subscriptions" ("user_id", "folder_id") WHERE "folder_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "newsletter_subscriptions_user_no_folder_key"
  ON "newsletter_subscriptions" ("user_id") WHERE "folder_id" IS NULL;

-- ── 3. Category rules become a table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "newsletter_category_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "config_id" uuid NOT NULL REFERENCES "newsletter_subscriptions"("id") ON DELETE CASCADE,
  "category" text NOT NULL,
  "cadence" text NOT NULL DEFAULT 'every_issue',
  "cadence_weekday" smallint,
  "depth" text NOT NULL DEFAULT 'short',
  "time_filter" text NOT NULL DEFAULT 'any',
  "lookahead_days" smallint,
  "sort_order" smallint NOT NULL DEFAULT 0,
  CONSTRAINT "newsletter_category_rules_config_category_key" UNIQUE ("config_id", "category")
);

CREATE INDEX IF NOT EXISTS "newsletter_category_rules_config_id_idx"
  ON "newsletter_category_rules" ("config_id");

-- Carry the JSONB rules across, once. The old `frequency` on a rule was
-- absolute ("daily"); the new `cadence` is relative to the envelope, so daily
-- becomes `every_issue` — in a daily newsletter those are the same thing, and
-- in a weekly one the old value was never achievable in the first place.
--
-- The global after-hour lands on every rule *except* museums, which is the
-- whole reason this filter moved: a reader who wanted evening cinema was
-- unknowingly hiding every exhibition they follow.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'newsletter_subscriptions' AND column_name = 'category_rules'
  ) THEN
    INSERT INTO "newsletter_category_rules"
      ("config_id", "category", "cadence", "depth", "time_filter", "sort_order")
    SELECT
      s."id",
      r."category",
      CASE r."frequency" WHEN 'weekly' THEN 'weekly' WHEN 'monthly' THEN 'monthly'
                         ELSE 'every_issue' END,
      CASE r."detail" WHEN 'full' THEN 'full' WHEN 'line' THEN 'line' ELSE 'short' END,
      CASE
        WHEN lower(r."category") IN ('exhibition', 'museum', 'museums') THEN 'any'
        WHEN s."after_hour" >= 20 THEN 'after_20'
        WHEN s."after_hour" >= 19 THEN 'after_19'
        WHEN s."after_hour" >= 18 THEN 'after_18'
        WHEN s."after_hour" >= 17 THEN 'after_17'
        ELSE 'any'
      END,
      r."ord"
    FROM "newsletter_subscriptions" s
    CROSS JOIN LATERAL jsonb_to_recordset(s."category_rules")
      AS r("category" text, "frequency" text, "detail" text)
    WITH ORDINALITY AS t(r, "ord")
    WHERE jsonb_typeof(s."category_rules") = 'array'
    ON CONFLICT ("config_id", "category") DO NOTHING;
  END IF;
END $$;

ALTER TABLE "newsletter_subscriptions" DROP COLUMN IF EXISTS "category_rules";
ALTER TABLE "newsletter_subscriptions" DROP COLUMN IF EXISTS "after_hour";
ALTER TABLE "newsletter_subscriptions" DROP COLUMN IF EXISTS "frequency";

-- ── 4. What has already been said, and in what state ────────────────────────
CREATE TABLE IF NOT EXISTS "newsletter_sent_events" (
  "config_id" uuid NOT NULL REFERENCES "newsletter_subscriptions"("id") ON DELETE CASCADE,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "state" text NOT NULL,
  "sent_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("config_id", "event_id", "state")
);

CREATE INDEX IF NOT EXISTS "newsletter_sent_events_sent_at_idx"
  ON "newsletter_sent_events" ("sent_at");

-- ── 5. Changes the scraper noticed to an event that already existed ─────────
CREATE TABLE IF NOT EXISTS "event_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "change_type" text NOT NULL,
  "old_value" text,
  "new_value" text,
  "detected_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "event_changes_event_id_idx" ON "event_changes" ("event_id");
CREATE INDEX IF NOT EXISTS "event_changes_detected_at_idx" ON "event_changes" ("detected_at");
