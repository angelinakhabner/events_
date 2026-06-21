-- Remove Teatr Studio. Its /spektakl/ listing is a play catalog without
-- showtimes (yields undated entries), and the /repertuar/ alternative mixes in
-- non-theatre events — not worth surfacing bad data. events/scrape_runs cascade.
-- Matched by name so it works regardless of which URL the row currently holds.
-- Idempotent: no-op on a fresh DB and after the first run.
DELETE FROM venues WHERE name = 'Teatr Studio';
