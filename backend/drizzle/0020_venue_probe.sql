-- GOI-72: remember how each venue can be read, instead of rediscovering it.
--
-- The add-venue CHECK button now runs a detector ladder (JSON-LD → iCal →
-- WordPress REST → RSS → LLM → paid browser render) and settles on one method.
-- Storing that method is the whole point: `jsonld`, `ical` and `wp_rest`
-- venues are free to refetch, so the daily sweep can skip both the SHA-256
-- unchanged-check and the Claude call for them. Only `rss`, `llm_extract` and
-- `firecrawl` need cost control.
--
-- `normalized_url` is the real deduplication key. `venues.url` keeps whatever
-- string the first user happened to paste, which is why "teatr.pl",
-- "https://teatr.pl/" and "https://teatr.pl/?utm_source=fb" could each become a
-- separate venue scraped separately. The unique index closes that.
--
-- Nullable on purpose: existing rows have never been probed, and backfilling
-- would mean fetching every venue's site inside a migration. They fill in as
-- each venue is next probed. The unique index tolerates this — Postgres treats
-- NULLs as distinct.
--
-- `requires_paid_fetch` is the one an operator needs to see: those venues bill
-- a vendor on every sweep.
--
-- Idempotent: safe to re-run.

ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "normalized_url" text;
ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "source_url" text;
ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "source_method" text;
ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "source_confidence" text;
ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "requires_paid_fetch" boolean NOT NULL DEFAULT false;
ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "last_probed_at" timestamptz;
ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "probe_error_code" text;
ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "probe_result" jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS "venues_normalized_url_unique"
  ON "venues" ("normalized_url");

-- Which venues cost money to sweep, at a glance.
CREATE INDEX IF NOT EXISTS "venues_requires_paid_fetch_idx"
  ON "venues" ("requires_paid_fetch") WHERE "requires_paid_fetch";

-- Per-run vendor spend, alongside the existing status/events_found columns, so
-- the paid tier is auditable from the same place as everything else.
ALTER TABLE "scrape_runs" ADD COLUMN IF NOT EXISTS "firecrawl_credits" integer NOT NULL DEFAULT 0;
