-- GOI-108: "please delete duplicates for theatres (TR Warszawa)".
--
-- `seed()` upserts each curated venue `ON CONFLICT (url)`, so a venue's URL is
-- its identity. Six of them have had that URL changed since they were first
-- seeded — writing a deterministic scraper for a venue usually meant reading a
-- different page from the one the model had been given — and every one of
-- those changes *inserted a second row* rather than repointing the first. The
-- old row stays in `venues`, stays subscribed to by everyone seeded before the
-- change, and sits beside its replacement in the venue list. TR Warszawa is
-- the one that got noticed; the other five are the same fault.
--
-- GOI-31 hit this once and fixed it the right way for MSN alone (0017), by
-- repointing the row before the new URL had been inserted. These need the
-- merge as well as the repoint, because both rows already exist.
--
-- Subscriptions move to the surviving row; the stale row goes, taking its
-- events with it by cascade. Those events are duplicates of the survivor's,
-- scraped from a page that in most cases no longer answers.
--
-- Idempotent: a no-op on a fresh database and on every run after the first.

-- 1. Both rows present: move the subscriptions. A reader who had only the
--    stale one keeps their overrides; one who had both keeps the survivor's.
INSERT INTO user_venues (user_id, venue_id, name_override, category_override, window_days, list_id, tags, created_at)
SELECT uv.user_id, keep.id, uv.name_override, uv.category_override, uv.window_days, uv.list_id, uv.tags, uv.created_at
  FROM (VALUES
    -- b2a4c02, deterministic scrapers for the three theatres.
    ('https://trwarszawa.pl/repertuar/',
     'https://trwarszawa.pl/kalendarz/{{YYYY}}/{{MM}}/?view=calendar'),
    ('https://nowyteatr.org/pl/repertuar',
     'https://nowyteatr.org/pl/kalendarz'),
    -- ad67b8a, Zachęta's calendar rather than its home page.
    ('https://zacheta.art.pl/en',
     'https://zacheta.art.pl/pl/kalendarz'),
    -- e14a41d then 335ce0b: MNW moved twice, so both earlier spellings are stale.
    ('https://mnw.art.pl/wydarzenia/kalendarium/',
     'https://mnw.art.pl/wydarzenia/kalendarz-wydarzen/{{MM-YYYY}},lista,miesiac.html'),
    ('https://mnw.art.pl/wydarzenia/kalendarz-wydarzen/{{MM-YYYY}},miesiac.html',
     'https://mnw.art.pl/wydarzenia/kalendarz-wydarzen/{{MM-YYYY}},lista,miesiac.html'),
    ('https://krolikarnia.mnw.art.pl/wydarzenia/kalendarz-wydarzen/',
     'https://krolikarnia.mnw.art.pl/wydarzenia/kalendarz-wydarzen/{{MM-YYYY}},lista,miesiac.html')
  ) AS s(stale_url, current_url)
  JOIN venues stale_v ON stale_v.url = s.stale_url
  JOIN venues keep ON keep.url = s.current_url
  JOIN user_venues uv ON uv.venue_id = stale_v.id
ON CONFLICT (user_id, venue_id) DO NOTHING;

-- 2. …then the stale row itself, whose events and subscriptions cascade.
DELETE FROM venues v
 USING (VALUES
    ('https://trwarszawa.pl/repertuar/',
     'https://trwarszawa.pl/kalendarz/{{YYYY}}/{{MM}}/?view=calendar'),
    ('https://nowyteatr.org/pl/repertuar',
     'https://nowyteatr.org/pl/kalendarz'),
    ('https://zacheta.art.pl/en',
     'https://zacheta.art.pl/pl/kalendarz'),
    ('https://mnw.art.pl/wydarzenia/kalendarium/',
     'https://mnw.art.pl/wydarzenia/kalendarz-wydarzen/{{MM-YYYY}},lista,miesiac.html'),
    ('https://mnw.art.pl/wydarzenia/kalendarz-wydarzen/{{MM-YYYY}},miesiac.html',
     'https://mnw.art.pl/wydarzenia/kalendarz-wydarzen/{{MM-YYYY}},lista,miesiac.html'),
    ('https://krolikarnia.mnw.art.pl/wydarzenia/kalendarz-wydarzen/',
     'https://krolikarnia.mnw.art.pl/wydarzenia/kalendarz-wydarzen/{{MM-YYYY}},lista,miesiac.html')
  ) AS s(stale_url, current_url)
 WHERE v.url = s.stale_url
   AND EXISTS (SELECT 1 FROM venues k WHERE k.url = s.current_url);

-- 3. Only the stale row present — the URL changed but the replacement was
--    never inserted. Repoint it, as 0017 did, so no duplicate is created.
UPDATE venues v
   SET url = s.current_url
  FROM (VALUES
    ('https://trwarszawa.pl/repertuar/',
     'https://trwarszawa.pl/kalendarz/{{YYYY}}/{{MM}}/?view=calendar'),
    ('https://nowyteatr.org/pl/repertuar',
     'https://nowyteatr.org/pl/kalendarz'),
    ('https://zacheta.art.pl/en',
     'https://zacheta.art.pl/pl/kalendarz'),
    ('https://mnw.art.pl/wydarzenia/kalendarium/',
     'https://mnw.art.pl/wydarzenia/kalendarz-wydarzen/{{MM-YYYY}},lista,miesiac.html'),
    ('https://mnw.art.pl/wydarzenia/kalendarz-wydarzen/{{MM-YYYY}},miesiac.html',
     'https://mnw.art.pl/wydarzenia/kalendarz-wydarzen/{{MM-YYYY}},lista,miesiac.html'),
    ('https://krolikarnia.mnw.art.pl/wydarzenia/kalendarz-wydarzen/',
     'https://krolikarnia.mnw.art.pl/wydarzenia/kalendarz-wydarzen/{{MM-YYYY}},lista,miesiac.html')
  ) AS s(stale_url, current_url)
 WHERE v.url = s.stale_url
   AND NOT EXISTS (SELECT 1 FROM venues k WHERE k.url = s.current_url);
