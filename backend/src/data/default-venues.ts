import type { Venue } from '@afisz/shared';

const PL: Pick<Venue, 'city' | 'country' | 'language' | 'timezone' | 'createdAt'> = {
  city: 'Warsaw',
  country: 'PL',
  language: 'pl',
  timezone: 'Europe/Warsaw',
  createdAt: '2025-01-01T00:00:00.000Z',
};

export const DEFAULT_VENUES: Venue[] = [
  // ─── Cinema ───────────────────────────────────────────────────────────────
  {
    id: 'kino-muranow',
    name: 'Kino Muranów',
    url: 'https://kinomuranow.pl/repertuar',
    category: 'cinema',
    ...PL,
  },
  {
    id: 'kino-iluzjon',
    name: 'Kino Iluzjon',
    url: 'https://www.iluzjon.fn.org.pl/repertuar.html',
    category: 'cinema',
    ...PL,
  },
  {
    id: 'kinoteka',
    name: 'Kinoteka',
    url: 'https://kinoteka.pl/repertuar/',
    category: 'cinema',
    ...PL,
  },

  // ─── Theatre ──────────────────────────────────────────────────────────────
  {
    id: 'teatr-powszechny',
    name: 'Teatr Powszechny',
    // {{YYYY-MM}} is substituted with the current month at fetch time so the
    // repertoire URL never goes stale (see resolveVenueUrl in the runner).
    url: 'https://powszechny.com/pl/repertuar?miesiac={{YYYY-MM}}',
    category: 'theatre',
    ...PL,
  },
  {
    id: 'nowy-teatr',
    name: 'Nowy Teatr',
    // /pl/repertuar is a JS shell; /pl/kalendarz renders the agenda server-side
    // when queried with the filter form's date_from/date_to params, which the
    // deterministic scraper appends per month.
    url: 'https://nowyteatr.org/pl/kalendarz',
    category: 'theatre',
    ...PL,
  },
  {
    id: 'tr-warszawa',
    name: 'TR Warszawa',
    // /repertuar/ is a JS shell; the month calendar pages are server-rendered
    // and feed the deterministic scraper (which swaps the YYYY/MM segment for
    // sibling months). NOTE: dark over the summer — July/August are sparse.
    url: 'https://trwarszawa.pl/kalendarz/{{YYYY}}/{{MM}}/?view=calendar',
    category: 'theatre',
    ...PL,
  },
  {
    id: 'teatr-studio',
    name: 'Teatr Studio',
    // Removed in migration 0004 because /spektakl/ was a play catalogue with
    // no showtimes. The site has since been rebuilt: /repertuar is a month
    // grid carrying a time per stage, which the deterministic scraper parses
    // (GOI-39). 0004 is already applied, and on a fresh database it runs
    // before the seed, so re-adding here is enough — no new migration.
    url: 'https://teatrstudio.pl/repertuar',
    category: 'theatre',
    ...PL,
  },
  {
    id: 'teatr-dramatyczny',
    name: 'Teatr Dramatyczny',
    url: 'https://teatrdramatyczny.pl/repertuar/',
    category: 'theatre',
    ...PL,
  },

  // ─── Exhibition / Museum ──────────────────────────────────────────────────
  {
    id: 'zacheta',
    name: 'Zachęta — National Gallery of Art',
    // /en is the homepage and carries no dated listing. The calendar is
    // server-rendered and marks each dated row `li.list-item.is-event`, which
    // the deterministic scraper parses (GOI-31).
    url: 'https://zacheta.art.pl/pl/kalendarz',
    category: 'exhibition',
    ...PL,
  },
  {
    id: 'msn',
    name: 'Muzeum Sztuki Nowoczesnej',
    // The site was rebuilt on Next.js and the old query string now 404s; the
    // programme is server-rendered at the bare path (GOI-31).
    url: 'https://artmuseum.pl/en/program-1',
    category: 'exhibition',
    ...PL,
  },
  {
    id: 'csw-zamek-ujazdowski',
    name: 'CSW Zamek Ujazdowski',
    url: 'https://u-jazdowski.pl/en/wydarzenia',
    category: 'exhibition',
    ...PL,
  },
  {
    id: 'polin',
    name: 'POLIN',
    url: 'https://polin.pl/en/kalendarium',
    category: 'exhibition',
    ...PL,
  },
  {
    id: 'muzeum-narodowe',
    name: 'Muzeum Narodowe',
    // /wystawy lists ongoing exhibitions without dates — the validator drops
    // every row. The month calendar's LIST view carries the dated listing in
    // the shape the deterministic edito scraper parses; {{MM-YYYY}} keeps it
    // on the current month and the scraper swaps the segment for siblings.
    url: 'https://mnw.art.pl/wydarzenia/kalendarz-wydarzen/{{MM-YYYY}},lista,miesiac.html',
    category: 'exhibition',
    ...PL,
  },
  {
    id: 'krolikarnia',
    name: 'Królikarnia',
    // Same as MNW: /wystawy/ is undated; the event calendar's list view has
    // real dates and matches the shared edito scraper.
    url: 'https://krolikarnia.mnw.art.pl/wydarzenia/kalendarz-wydarzen/{{MM-YYYY}},lista,miesiac.html',
    category: 'exhibition',
    ...PL,
  },
  {
    id: 'poster-museum',
    name: 'Muzeum Plakatu w Wilanowie',
    // A third MNW branch on the same edito CMS, so the calendar needs no new
    // parser. Its scraper adds /wystawy/, where the exhibition runs live as
    // Polish prose ("20 czerwca - 13 września 2026") rather than dated rows
    // (GOI-57).
    url: 'https://www.postermuseum.pl/wydarzenia/kalendarz-wydarzen/{{MM-YYYY}},lista,miesiac.html',
    category: 'exhibition',
    ...PL,
  },

  // ─── Comedy ───────────────────────────────────────────────────────────────
  {
    id: 'klub-komediowy',
    name: 'Klub Komediowy',
    url: 'https://komediowy.pl/repertuar/',
    category: 'comedy',
    ...PL,
  },

  // ─── Music ────────────────────────────────────────────────────────────────
  {
    id: 'filharmonia',
    name: 'Filharmonia Narodowa',
    url: 'https://filharmonia.pl/repertuar/',
    category: 'music',
    ...PL,
  },
  {
    // The club spells itself "Jassmine"; the `jazzmine` id is a leftover from
    // its old jazzmine.pl domain (migrated to jassmine.com in 0003) and is
    // internal only — venue rows key on url, and the deterministic scraper
    // resolves by hostname.
    id: 'jazzmine',
    name: 'Jassmine',
    url: 'https://jassmine.com/koncerty/',
    category: 'music',
    ...PL,
  },
];
