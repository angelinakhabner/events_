-- Several venues were seeded with the wrong URL — homepages instead of listing
-- pages (powszechny, komediowy, krolikarnia, zacheta), a dead/incorrect domain
-- (jazzmine.pl → jassmine.com), or a path that 403s / TLS-fails / 404s
-- (polin, msn, ujazdowski) — plus a couple of corrected repertoire paths.
--
-- Migrate each row in place so the post-migration seed (ON CONFLICT (url) DO
-- UPDATE) updates the same row instead of inserting a duplicate venue with a
-- new UUID. The new strings must match default-venues.ts exactly, including the
-- {{YYYY-MM}} / {{YYYY-MM-DD}} placeholders the runner substitutes at fetch time.
--
-- Idempotent: no-op on a fresh DB (0 rows match) and after the first run.
UPDATE venues SET url = 'https://www.iluzjon.fn.org.pl/repertuar.html'              WHERE url = 'https://iluzjon.fn.org.pl/repertuar/';
UPDATE venues SET url = 'https://teatrstudio.pl/pl/teatr/kategorie-wydarzen/spektakl/' WHERE url = 'https://teatrstudio.pl/repertuar/';
UPDATE venues SET url = 'https://powszechny.com/pl/repertuar?miesiac={{YYYY-MM}}'    WHERE url = 'https://www.powszechny.com/';
UPDATE venues SET url = 'https://komediowy.pl/repertuar/'                            WHERE url = 'https://komediowy.pl/';
UPDATE venues SET url = 'https://jassmine.com/koncerty/'                             WHERE url = 'https://jazzmine.pl/';
UPDATE venues SET url = 'https://krolikarnia.mnw.art.pl/wystawy/'                    WHERE url = 'https://krolikarnia.mnw.art.pl/';
UPDATE venues SET url = 'https://polin.pl/en/kalendarium'                            WHERE url = 'https://polin.pl/pl/wydarzenia';
UPDATE venues SET url = 'https://artmuseum.pl/en/program-1?from={{YYYY-MM-DD}}&type=all' WHERE url = 'https://artmuseum.pl/pl/wystawy';
UPDATE venues SET url = 'https://zacheta.art.pl/en'                                  WHERE url = 'https://zacheta.art.pl/';
UPDATE venues SET url = 'https://u-jazdowski.pl/en/wydarzenia'                       WHERE url = 'https://u-jazdowski.pl/program';
UPDATE venues SET url = 'https://kinoteka.pl/repertuar/'                             WHERE url = 'https://kinoteka.pl/';

-- Drop Muzeum Powstania Warszawskiego: its listing URL moved and no working
-- replacement is available. The events/scrape_runs FKs are ON DELETE CASCADE,
-- so this also removes its events and run history. Idempotent (0 rows after).
DELETE FROM venues WHERE url = 'https://1944.pl/wydarzenia';
