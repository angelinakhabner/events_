-- GOI-79: record what description enrichment cost, so it can be capped.
--
-- Descriptions were null across museum and theatre venues, and the cause was
-- never a broken selector: a calendar page carries a title, a date, a time and
-- a link. The description only exists on the linked detail page. Fetching it
-- means one HTTP request and one model call per distinct show — the first
-- thing in this pipeline whose cost scales with how much a venue is putting
-- on, rather than with how many venues there are.
--
-- So the run records it. `detail_fetches` is the number to watch; the token
-- columns are what it actually cost. All three sit next to the existing
-- events_found / firecrawl_credits metrics rather than in a new table,
-- because they answer the same question about the same run.
--
-- Defaults are 0 and NOT NULL: every historical run enriched nothing through
-- this path, which is exactly what 0 means. No backfill needed.
--
-- Idempotent: safe to re-run.

ALTER TABLE "scrape_runs" ADD COLUMN IF NOT EXISTS "detail_fetches" integer NOT NULL DEFAULT 0;
ALTER TABLE "scrape_runs" ADD COLUMN IF NOT EXISTS "detail_input_tokens" integer NOT NULL DEFAULT 0;
ALTER TABLE "scrape_runs" ADD COLUMN IF NOT EXISTS "detail_output_tokens" integer NOT NULL DEFAULT 0;

-- Finding the expensive runs: partial, because nearly every run has none.
CREATE INDEX IF NOT EXISTS "scrape_runs_detail_fetches_idx"
  ON "scrape_runs" ("detail_fetches") WHERE "detail_fetches" > 0;

-- Enrichment only ever fetches a detail page for an event whose description is
-- still missing, and it looks that up by (venue_id, source_url). Without this
-- the check is a sequential scan of events on every scrape.
CREATE INDEX IF NOT EXISTS "events_venue_source_url_idx"
  ON "events" ("venue_id", "source_url");
