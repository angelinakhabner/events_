-- GOI-140 / GOI-141: how a newsletter arranges its listings.
--
-- `group_by` picks between one entry per title, with every venue showing it
-- underneath ('event', what every issue has done so far), and a block per
-- venue inside each category ('venue').
--
-- `venue_order` is the reader's own order of venues, by id: the venue blocks
-- follow it, and so do a title's venue lines. Venues it does not name come
-- after, in the issue's own order, so a venue added later is never dropped.
-- Empty means no preference.
--
-- Idempotent: migrate.ts re-runs every file on every deploy.

ALTER TABLE "newsletter_subscriptions" ADD COLUMN IF NOT EXISTS "group_by" text NOT NULL DEFAULT 'event';
ALTER TABLE "newsletter_subscriptions" ADD COLUMN IF NOT EXISTS "venue_order" text[] NOT NULL DEFAULT ARRAY[]::text[];
