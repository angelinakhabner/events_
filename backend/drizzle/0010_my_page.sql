-- /my page rework (GOI-24 … GOI-28). Idempotent: safe to re-run.

-- GOI-25: personal, free-form tags on a venue subscription. The venue row
-- stays global; tags are what *this* user filed it under.
ALTER TABLE "user_venues" ADD COLUMN IF NOT EXISTS
  "tags" text[] NOT NULL DEFAULT ARRAY[]::text[];

-- GOI-26: "want to go" entries can be marked seen instead of only removed,
-- so the list keeps a record of what you actually went to.
ALTER TABLE "want_to_go" ADD COLUMN IF NOT EXISTS
  "seen_at" timestamptz;

-- GOI-28: the brief's send schedule (hour, and weekday for weekly briefs) and
-- which events it covers (all / only titles running every day / one weekday).
ALTER TABLE "newsletter_subscriptions" ADD COLUMN IF NOT EXISTS
  "send_hour" integer NOT NULL DEFAULT 8;
ALTER TABLE "newsletter_subscriptions" ADD COLUMN IF NOT EXISTS
  "send_weekday" integer NOT NULL DEFAULT 1;
ALTER TABLE "newsletter_subscriptions" ADD COLUMN IF NOT EXISTS
  "event_day_mode" text NOT NULL DEFAULT 'all';
ALTER TABLE "newsletter_subscriptions" ADD COLUMN IF NOT EXISTS
  "event_day" integer;
