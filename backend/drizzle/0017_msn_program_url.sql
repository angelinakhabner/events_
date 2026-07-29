-- GOI-31: artmuseum.pl was rebuilt on Next.js and the old query-string URL
-- (`/en/program-1?from=…&type=all`) now 404s — the venue could not be fetched
-- at all. The programme is server-rendered at the bare path, which the new
-- deterministic scraper parses.
--
-- The seeded value carried a {{YYYY-MM-DD}} placeholder that the runner
-- substitutes at fetch time, so match on the stored template, and on any
-- already-substituted variant, rather than a single literal.
--
-- Idempotent: no-op on a fresh DB and after the first run.
UPDATE venues
   SET url = 'https://artmuseum.pl/en/program-1'
 WHERE url LIKE 'https://artmuseum.pl/en/program-1?%';
