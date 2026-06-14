-- klubkomediowy.pl returns ENOTFOUND from Railway (DNS dead).
-- The real venue lives at komediowy.pl. Migrate the existing row in place
-- so the post-migration seed (ON CONFLICT (url) DO UPDATE) sees the new URL
-- and updates the same row, instead of inserting a duplicate "Klub Komediowy"
-- venue with a new UUID.
--
-- Idempotent: no-op on a fresh DB (0 rows match) and after the first run.
UPDATE venues
   SET url = 'https://komediowy.pl/'
 WHERE url = 'https://klubkomediowy.pl/';
