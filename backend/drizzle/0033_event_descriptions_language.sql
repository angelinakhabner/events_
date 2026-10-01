-- The site speaks Polish now, so the descriptions it writes do too.
--
-- 0030 cached one English description per show (GOI-130). Those answers are
-- still right about the work and wrong about the language, so rather than
-- delete them — every migration re-runs on deploy, and a DELETE here would
-- empty the cache on every deploy after — each row records the language it
-- was written in. Rows from before this column are English by construction;
-- the enrichment pass only reads rows in the site's language, and rewrites a
-- show in place the first time it meets one written in another.
--
-- Idempotent: migrate.ts re-runs every file on every deploy.

ALTER TABLE "event_descriptions" ADD COLUMN IF NOT EXISTS "lang" text NOT NULL DEFAULT 'en';
