-- GOI-141 / GOI-140: how a newsletter lists what is on, and in which order.
--
-- `group_by`: 'event' lists each event once with every venue and date under
-- it — the brief as it has been. 'venue' lists each venue with its own events
-- under it, for a reader who thinks "what's on at Muranów" rather than "is
-- that film on anywhere".
--
-- `venue_order`: the reader's own order for their venues, set by hand in the
-- newsletter form. Venue ids, first first; a venue not in it follows the ones
-- that are. Empty means no order was chosen.
--
-- Idempotent: migrate.ts re-runs every file on every deploy.

ALTER TABLE "newsletter_subscriptions"
  ADD COLUMN IF NOT EXISTS "group_by" text NOT NULL DEFAULT 'event';

ALTER TABLE "newsletter_subscriptions"
  ADD COLUMN IF NOT EXISTS "venue_order" text[] NOT NULL DEFAULT ARRAY[]::text[];
