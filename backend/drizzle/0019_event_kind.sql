-- GOI-67: museums list two different things, and the schema only knew one.
--
-- An exhibition runs over a date *range* and has no meaningful start time; a
-- workshop or a guided tour is a single occurrence with a real clock time.
-- Until now every row was the latter, so exhibitions were given a fabricated
-- hour (the scrapers fell back to local midnight and the listing printed it).
--
-- `kind` names the distinction explicitly instead of inferring it from a
-- midnight timestamp, and `ends_at` carries the closing date for a run.
--
-- Backfill: every existing row stays 'timed'. That is correct for the cinema,
-- theatre, comedy and music data, and for museums it is merely the status quo
-- — those rows have no `ends_at` to satisfy the exhibition invariant, so they
-- keep working through the legacy all-day path until the next sweep re-extracts
-- them with a real range.
--
-- Idempotent: safe to re-run.

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'timed';

DO $$ BEGIN
  ALTER TABLE "events" ADD CONSTRAINT "events_kind_valid"
    CHECK ("kind" IN ('timed', 'exhibition'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- An exhibition without a closing date is indistinguishable from a timed row
-- with a missing hour, which is the bug this column exists to end. A range that
-- closes before it opens is a mis-parse; both are rejected at the storage layer
-- so a bad extraction can't reach the listing.
DO $$ BEGIN
  ALTER TABLE "events" ADD CONSTRAINT "events_exhibition_has_range"
    CHECK ("kind" <> 'exhibition' OR ("ends_at" IS NOT NULL AND "ends_at" >= "starts_at"));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The listing asks "which runs cover today", which is a scan over open-ended
-- ranges rather than the start-time lookup events_starts_at_idx serves.
CREATE INDEX IF NOT EXISTS "events_kind_ends_at_idx" ON "events" ("kind", "ends_at");
