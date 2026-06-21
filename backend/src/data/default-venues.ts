import type { Venue } from '@goin/shared';

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
    url: 'https://nowyteatr.org/pl/repertuar',
    category: 'theatre',
    ...PL,
  },
  {
    id: 'tr-warszawa',
    name: 'TR Warszawa',
    url: 'https://trwarszawa.pl/repertuar/',
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
    url: 'https://zacheta.art.pl/en',
    category: 'exhibition',
    ...PL,
  },
  {
    id: 'msn',
    name: 'Muzeum Sztuki Nowoczesnej',
    // {{YYYY-MM-DD}} → today's date at fetch time (see resolveVenueUrl).
    url: 'https://artmuseum.pl/en/program-1?from={{YYYY-MM-DD}}&type=all',
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
    url: 'https://mnw.art.pl/wystawy',
    category: 'exhibition',
    ...PL,
  },
  {
    id: 'krolikarnia',
    name: 'Królikarnia',
    url: 'https://krolikarnia.mnw.art.pl/wystawy/',
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
    id: 'jazzmine',
    name: 'Jazzmine',
    url: 'https://jassmine.com/koncerty/',
    category: 'music',
    ...PL,
  },
];
