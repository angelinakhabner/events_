-- GOI-146: what a museums section carries.
--
-- "Museums" is two things — runs you can drop in on for weeks, and talks,
-- tours and screenings at a time (GOI-122) — and a reader may want only one
-- of them in their newsletter. `museum_content` is that choice on a category
-- rule: 'both' (as before), 'exhibitions' or 'events'. Only the museums rule
-- reads it; every other rule keeps 'both'.
--
-- Idempotent: migrate.ts re-runs every file on every deploy.

ALTER TABLE "newsletter_category_rules"
  ADD COLUMN IF NOT EXISTS "museum_content" text NOT NULL DEFAULT 'both';
