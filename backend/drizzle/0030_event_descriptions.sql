-- GOI-130 / GOI-131: one English description per show, written once.
--
-- Descriptions used to be whatever the source said, in whatever language it
-- said it: Polish from the theatres, Italian from one of MSN's feeds, and — at
-- the deterministic theatres — not a description at all but the listing's
-- logistics ("spektakl z napisami w języku angielskim — Scena: scena duża").
-- The enrichment pass now writes every show's description in English, about
-- the work, searching the web when the venue's own page says nothing.
--
-- That is a model call per show, and a web search for some, so the answer is
-- kept here rather than on the event rows: a show is many rows (one per
-- showing), rows are pruned when the listing moves on, and "we looked and
-- found nothing" has to be remembered too, or the same fruitless search is
-- paid for on every sweep.
--
-- `show_key` is the show's detail-page URL, or `title:<normalised title>` for
-- a venue whose listing links nowhere more specific.
--
-- Idempotent: migrate.ts re-runs every file on every deploy.

CREATE TABLE IF NOT EXISTS "event_descriptions" (
  "venue_id" uuid NOT NULL REFERENCES "venues" ("id") ON DELETE CASCADE,
  "show_key" text NOT NULL,
  -- Null: the writer looked (and, where it could, searched) and found nothing.
  "description" text,
  "content_category" text,
  -- Whether the answer needed a web search — the cost signal, and the audit
  -- trail for a description that did not come from the venue.
  "searched" boolean NOT NULL DEFAULT false,
  "written_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("venue_id", "show_key")
);
