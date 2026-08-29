-- GOI-101: an event someone saved is marked cancelled, not deleted.
--
-- `pruneStaleEvents` deletes rows a successful scrape should have seen and
-- didn't, which is right for the listing — the venue has stopped advertising
-- them. It is wrong for the reader who saved one: `want_to_go.event_id`
-- cascades, so the delete took their bookmark with it. The newsletter cannot
-- tell someone their saved event was cancelled if cancelling it also erases
-- the record that they saved it.
--
-- So a pruned row that someone has saved is kept and stamped instead. It stays
-- out of every listing (the queries add `cancelled_at IS NULL`) and stays in
-- their "want to go" list, where the fact that it is cancelled is the point.
--
-- Idempotent: migrate.ts re-runs every file on every deploy.

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamptz;

-- Partial: the overwhelming majority of rows are null, and the queries that
-- read this column are asking for exactly those.
CREATE INDEX IF NOT EXISTS "events_cancelled_at_idx"
  ON "events" ("cancelled_at") WHERE "cancelled_at" IS NOT NULL;
