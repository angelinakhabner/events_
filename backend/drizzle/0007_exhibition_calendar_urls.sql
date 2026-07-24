-- MNW and Królikarnia were pointed at their /wystawy pages, which list
-- ongoing exhibitions WITHOUT dates or times — the validator rejects every
-- extracted row, so both venues have sat at 0 events since launch. Their
-- month-calendar LIST pages carry the dated event listings in the exact
-- markup the deterministic edito scraper parses (no LLM call).
--
-- Migrate each row in place so the post-migration seed (ON CONFLICT (url) DO
-- UPDATE) updates the same row instead of inserting a duplicate venue with a
-- new UUID. The new strings must match default-venues.ts exactly, including
-- the {{MM-YYYY}} placeholder the runner substitutes at fetch time.
--
-- Idempotent: no-op on a fresh DB (0 rows match) and after the first run.
UPDATE venues SET url = 'https://mnw.art.pl/wydarzenia/kalendarz-wydarzen/{{MM-YYYY}},lista,miesiac.html'             WHERE url = 'https://mnw.art.pl/wystawy';
UPDATE venues SET url = 'https://krolikarnia.mnw.art.pl/wydarzenia/kalendarz-wydarzen/{{MM-YYYY}},lista,miesiac.html' WHERE url = 'https://krolikarnia.mnw.art.pl/wystawy/';
