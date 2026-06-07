-- Milestone 2: events + scrape_runs + venue timezone

ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "timezone" text NOT NULL DEFAULT 'Europe/Warsaw';

CREATE TABLE IF NOT EXISTS "events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "description" text,
  "starts_at" timestamptz NOT NULL,
  "ends_at" timestamptz,
  "category" text NOT NULL,
  "language" text,
  "director" text,
  "cast" text[],
  "duration_minutes" integer,
  "price_min" integer,
  "price_max" integer,
  "source_url" text NOT NULL,
  "source_id" text,
  "scraped_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "events_venue_id_idx" ON "events" ("venue_id");
CREATE INDEX IF NOT EXISTS "events_starts_at_idx" ON "events" ("starts_at");

-- Dedup strategy:
-- If the venue exposes a stable per-screening id, prefer (venue_id, source_id).
-- Otherwise fall back to (venue_id, source_url, starts_at).
CREATE UNIQUE INDEX IF NOT EXISTS "events_venue_source_id_uniq"
  ON "events" ("venue_id", "source_id") WHERE "source_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "events_venue_url_starts_uniq"
  ON "events" ("venue_id", "source_url", "starts_at") WHERE "source_id" IS NULL;

CREATE TABLE IF NOT EXISTS "scrape_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id") ON DELETE CASCADE,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz,
  "status" text NOT NULL,
  "events_found" integer,
  "error_message" text,
  "raw_hash" text
);

CREATE INDEX IF NOT EXISTS "scrape_runs_venue_id_idx" ON "scrape_runs" ("venue_id");
CREATE INDEX IF NOT EXISTS "scrape_runs_started_at_idx" ON "scrape_runs" ("started_at" DESC);
