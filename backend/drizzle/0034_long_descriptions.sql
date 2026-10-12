-- GOI-139: a longer description for the newsletter's "full" detail.
--
-- A description is one or two sentences, cut at 200 characters, so "full"
-- printed the same line "short" did. The writer now returns a paragraph about
-- the work on the same call, kept beside the line on both the show's cached
-- answer and its event rows.
--
-- `format` says which shape of answer a cached row holds. Rows from before
-- this file are format 1 (no paragraph); the enrichment pass reads only the
-- current format and rewrites older rows in place when their show next comes
-- up — the same gradual, per-run-capped backfill 0033 uses for language.
--
-- Idempotent: migrate.ts re-runs every file on every deploy.

ALTER TABLE "event_descriptions" ADD COLUMN IF NOT EXISTS "long_description" text;
ALTER TABLE "event_descriptions" ADD COLUMN IF NOT EXISTS "format" smallint NOT NULL DEFAULT 1;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "long_description" text;
