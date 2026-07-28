-- Per-category cadence and detail: "cinema daily, short; museums monthly,
-- wide". Replaces the flat tag list from 0011, which could only say *which*
-- categories to include, not how often each should turn up or how much it
-- should say.
--
-- Stored as JSONB rather than a child table: the rules are a small ordered
-- list owned entirely by one subscription, always read and written whole, and
-- never queried across subscriptions — the same reasons folders.filters is
-- JSONB. Shape: [{"category":"cinema","frequency":"daily","detail":"short"}]
--
-- 0011 landed today and has not been promoted past dev, so there is no stored
-- selection worth migrating.
-- Idempotent: safe to re-run.

ALTER TABLE "newsletter_subscriptions" ADD COLUMN IF NOT EXISTS
  "category_rules" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "newsletter_subscriptions" DROP COLUMN IF EXISTS "event_tags";
