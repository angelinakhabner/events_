-- How a newsletter looks: the classic brief ("classic") or the AFISZ.KA
-- redesign ("afiszka"), chosen per newsletter. Every existing newsletter keeps
-- the look it has been sent in until its reader switches.
--
-- Idempotent: migrate.ts re-runs every file on every deploy.

ALTER TABLE "newsletter_subscriptions" ADD COLUMN IF NOT EXISTS "design" text NOT NULL DEFAULT 'classic';
