-- GOI-92: folder names are matched case- and whitespace-insensitively.
--
-- The "Elsewhere" flow auto-creates a folder named after the searched city, and
-- it must be idempotent under concurrency — two commits for "Berlin" landing at
-- the same moment have to end up in one folder, without a read-then-write race.
-- The way to get that is to let the database decide: INSERT ... ON CONFLICT, on
-- a key that already treats `berlin`, `Berlin ` and `BERLIN` as the same folder.
--
-- 0006's UNIQUE ("user_id", "name") is exact-match, so it would happily accept
-- all three. It is replaced here by a unique index on the normalised name. The
-- canonical display form stays in `name` — only the *key* is normalised.
-- Idempotent: safe to re-run.

-- Any pre-existing pair that only differed by case or padding would block the
-- index, so disambiguate the newer one rather than merging folders behind the
-- user's back. The id fragment keeps the rename deterministic on re-runs and
-- can't itself collide.
WITH ranked AS (
  SELECT "id",
         row_number() OVER (
           PARTITION BY "user_id", lower(btrim("name"))
           ORDER BY "created_at" ASC, "id" ASC
         ) AS rn
  FROM "user_lists"
)
UPDATE "user_lists" ul
SET "name" = ul."name" || ' (' || left(ul."id"::text, 4) || ')'
FROM ranked r
WHERE r."id" = ul."id" AND r.rn > 1;

ALTER TABLE "user_lists" DROP CONSTRAINT IF EXISTS "user_lists_user_id_name_key";
ALTER TABLE "user_lists" DROP CONSTRAINT IF EXISTS "user_lists_user_id_name_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "user_lists_user_id_name_norm_idx"
  ON "user_lists" ("user_id", lower(btrim("name")));
