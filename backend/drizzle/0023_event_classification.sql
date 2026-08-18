-- GOI-80: museums produce one undifferentiated stream; give a row a content type.
--
-- A three-month exhibition and a Tuesday 17:00 guided tour were stored
-- identically, which breaks date filtering and makes "N UPCOMING" on the venue
-- list meaningless.
--
-- Three INDEPENDENT columns, deliberately not one enum and not a tree:
--
--   content_category  what kind of thing this is. Named `content_category`
--                     rather than `category` because events.category already
--                     exists and means the venue-derived cinema/theatre/…;
--                     overloading it would have silently corrupted every
--                     filter that reads it.
--   category_source   structural | keyword | llm — so a misclassification can
--                     be audited without re-running the scrape.
--   audience          'family' or null. Cross-cutting on purpose: "Warsztaty
--                     rodzinne" is a workshop AND family, and folding family
--                     into the category vocabulary would swallow the workshop
--                     signal. That is the bug this column exists to prevent.
--
-- Temporal shape stays in `kind` (added by 0019), which is what selects the
-- date predicate at query time. It is derived from structure alone and is
-- never overruled by a keyword or a model answer.
--
-- All nullable: existing rows are unclassified until their next sweep
-- re-extracts them, and a null reads as "not classified yet" rather than as a
-- wrong answer. No backfill — reclassifying non-museum venues is explicitly
-- out of scope for this ticket.
--
-- Idempotent: safe to re-run.

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "content_category" text;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "category_source" text;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "audience" text;

-- The filter row groups by content type within a venue category, and the
-- family toggle is an independent AND — both want an index that starts with
-- the column being grouped.
CREATE INDEX IF NOT EXISTS "events_content_category_idx"
  ON "events" ("content_category") WHERE "content_category" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "events_audience_idx"
  ON "events" ("audience") WHERE "audience" IS NOT NULL;
