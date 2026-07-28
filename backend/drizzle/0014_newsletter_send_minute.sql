-- The brief's send time gains minute precision: "every day at 08:30", not just
-- on the hour. Existing rows keep their behaviour — 0 past their chosen hour.
ALTER TABLE "newsletter_subscriptions" ADD COLUMN IF NOT EXISTS
  "send_minute" integer NOT NULL DEFAULT 0;
