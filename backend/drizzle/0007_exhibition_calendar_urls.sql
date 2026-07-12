-- MNW and Królikarnia were pointed at their /wystawy pages, which list
-- ongoing exhibitions WITHOUT dates or times — the validator rejects every
-- extracted row, so both venues have sat at 0 events since launch. Their
-- "Kalendarium" / "Kalendarz wydarzeń" pages carry the dated event listings.
--
-- Migrate each row in place so the post-migration seed (ON CONFLICT (url) DO
-- UPDATE) updates the same row instead of inserting a duplicate venue with a
-- new UUID. The new strings must match default-venues.ts exactly.
--
-- Idempotent: no-op on a fresh DB (0 rows match) and after the first run.
UPDATE venues SET url = 'https://mnw.art.pl/wydarzenia/kalendarz-wydarzen/{{MM-YYYY}},miesiac.html' WHERE url = 'https://mnw.art.pl/wystawy';
UPDATE venues SET url = 'https://krolikarnia.mnw.art.pl/wydarzenia/kalendarz-wydarzen/' WHERE url = 'https://krolikarnia.mnw.art.pl/wystawy/';
