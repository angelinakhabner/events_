-- GOI-139: a long description beside the short one.
--
-- The newsletter offers "one line", "short" and "full" descriptions, but there
-- was only ever one description to give: the writer's one or two sentences
-- (GOI-130 / GOI-131), so "full" printed the same text as "short". The writer
-- now returns a fuller paragraph about the work as well, kept per show in
-- `event_descriptions` and copied onto each showing's row like the short one.
--
-- `writer_version` marks which prompt wrote a stored answer. Answers written
-- before the long description existed are version 1: they keep being applied,
-- and are rewritten once (inside the usual per-run cap) to gain one.
--
-- Idempotent: migrate.ts re-runs every file on every deploy.

ALTER TABLE "event_descriptions"
  ADD COLUMN IF NOT EXISTS "long_description" text;

ALTER TABLE "event_descriptions"
  ADD COLUMN IF NOT EXISTS "writer_version" integer NOT NULL DEFAULT 1;

ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "description_long" text;
