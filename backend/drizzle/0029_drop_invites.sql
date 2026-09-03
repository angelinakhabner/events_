-- Open the site up: retire the pre-auth invite gate (GOI-83).
--
-- The gate was always described as temporary — "when magic-link auth ships,
-- this is deleted rather than migrated". Magic-link and Google sign-in have
-- shipped, so the site is now open to anyone: visitors browse, and anyone who
-- wants their own lists, venues or newsletter logs in with their email.
--
-- The table only ever held SHA-256 hashes of links that no longer open
-- anything, so there is nothing here worth keeping. 0022 still runs before
-- this file on a fresh database — creating the table and then dropping it is
-- harmless, and leaves both files honest about what happened.
--
-- Idempotent: safe to re-run.

DROP TABLE IF EXISTS "invites";
