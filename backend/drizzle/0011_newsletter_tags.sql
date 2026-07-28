-- Newsletter scope by venue tag instead of by day.
--
-- 0010 scoped a brief by *when* events run ("every day" / one weekday). What
-- the form actually needs is scoping by *what kind* of thing it is, and the
-- user already classifies their venues with tags (GOI-25) — so the brief now
-- narrows to venues carrying the chosen tags. Empty = every venue picked.
--
-- The day-mode columns land and leave inside the same unreleased dev cycle,
-- so there is no stored preference worth migrating.
-- Idempotent: safe to re-run.

ALTER TABLE "newsletter_subscriptions" ADD COLUMN IF NOT EXISTS
  "event_tags" text[] NOT NULL DEFAULT ARRAY[]::text[];

ALTER TABLE "newsletter_subscriptions" DROP COLUMN IF EXISTS "event_day_mode";
ALTER TABLE "newsletter_subscriptions" DROP COLUMN IF EXISTS "event_day";
