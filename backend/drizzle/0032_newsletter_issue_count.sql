-- A running count of the scheduled issues each newsletter config has sent.
--
-- The daily poster's masthead numbers its issues ("Daily / No. 3"), and there
-- was nothing to number them from: `last_sent_at` says when, not how many.
-- Incremented with `last_sent_at` on every successful scheduled send; urgent
-- change emails are not issues and do not count.
--
-- Existing configs start at 0 rather than a reconstruction from send history,
-- which is not kept. Idempotent: migrate.ts re-runs every file on every deploy.

ALTER TABLE "newsletter_subscriptions"
  ADD COLUMN IF NOT EXISTS "issues_sent" integer NOT NULL DEFAULT 0;
