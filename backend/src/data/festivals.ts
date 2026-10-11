import type { Festival, FestivalCategory } from '@afisz/shared';

// Curated festival calendar (GOI-6), filed by listing since GOI-68. Edit
// this file to add or correct entries — dates are inclusive ISO days. The API
// (festivals.list) filters out past editions and computes ongoing/upcoming
// server-side, so the frontend never needs date logic.

export interface FestivalSeed {
  id: string;
  name: string;
  /**
   * The festival's official page — checked against the live web, not guessed
   * from the name (GOI-109). Omit it, or set it to null, rather than filing a
   * domain that merely looks right: `skrzyzowaniekultur.pl` was one of those
   * and resolved to nothing, so the banner's "Festival site →" led to a DNS
   * error. `npm run festivals:check-links` (backend) re-checks every URL here
   * from a machine that can reach the outside world.
   *
   * Prefer the festival's evergreen page over this year's edition page: an
   * edition URL is correct for eleven months and a 404 for the twelfth.
   */
  url?: string | null;
  /** Which listing it belongs under (GOI-68). Every seed here is a film
   *  festival; a theatre or music one files itself by saying so. */
  category: FestivalCategory;
  /** Venue names hosting it — matched against the reader's own venue names,
   *  so spelling variants are folded by `festivalVenueMatches`. */
  venues: string[];
  city: string;
  startDate: string; // YYYY-MM-DD inclusive
  endDate: string; // YYYY-MM-DD inclusive
  description: string;
  /**
   * The festival's own banner, lifted from its site (GOI-99) — the artwork it
   * announces itself with, which is the one image that says "festival" faster
   * than any sentence. Omit it rather than substituting a stock photograph or
   * a venue shot: the banner falls back to setting the name in display type,
   * which is honest and still looks like the rest of the app.
   */
  imageUrl?: string | null;
}

export const FESTIVAL_SEEDS: FestivalSeed[] = [
  {
    // No link on purpose (GOI-109). The Vistula's open-air summer screenings
    // are programmed by the city and the individual beaches, not by one
    // festival with one site; `kinoletnie.pl` — which this used to point at —
    // belongs to the unrelated BNP Paribas Kino Letnie in Sopot and Zakopane,
    // which is a worse answer than no answer.
    id: 'kino-letnie-2026',
    name: 'Kino Letnie nad Wisłą',
    url: null,
    category: 'cinema',
    venues: ['Plac Zabaw', 'Boulevards of the Vistula'],
    city: 'Warsaw',
    startDate: '2026-06-19',
    endDate: '2026-08-30',
    description: 'Open-air summer screenings on the Vistula boulevards — free entry, films at dusk.',
  },
  {
    // GOI-99's own example. It reaches the listing as a run of identically
    // titled entries in Teatr Dramatyczny's repertoire — six rows saying
    // "FESTIWAL SKRZYŻOWANIE KULTUR" and nothing about what it is — which is
    // exactly the case a banner exists to answer.
    id: 'skrzyzowanie-kultur-2026',
    name: 'Festiwal Skrzyżowanie Kultur',
    // Stołeczna Estrada's own festival page. The obvious guess,
    // skrzyzowaniekultur.pl, is a lapsed domain parked for sale (GOI-109).
    url: 'https://estrada.com.pl/skrzyzowanie_kultur/',
    category: 'theatre',
    venues: ['Teatr Dramatyczny'],
    city: 'Warsaw',
    startDate: '2026-09-11',
    endDate: '2026-09-13',
    description: 'Warsaw’s crossroads-of-cultures festival — world music and stage work from across the map, at Teatr Dramatyczny.',
  },
  {
    id: 'wff-2026',
    name: 'Warsaw Film Festival',
    url: 'https://wff.pl',
    category: 'cinema',
    venues: ['Kinoteka', 'Kino Muranów', 'Multikino Złote Tarasy'],
    city: 'Warsaw',
    startDate: '2026-10-09',
    endDate: '2026-10-18',
    description: 'Warsaw’s flagship international festival — premieres, competitions and Q&As across the city’s big screens.',
  },
  {
    id: 'five-flavours-2026',
    name: 'Five Flavours Asian Film Festival',
    url: 'https://piecsmakow.pl',
    category: 'cinema',
    venues: ['Kino Muranów', 'Kinoteka'],
    city: 'Warsaw',
    startDate: '2026-11-10',
    endDate: '2026-11-17',
    description: 'The largest showcase of Asian cinema in Poland, from festival hits to genre discoveries.',
  },
  {
    id: 'watch-docs-2026',
    name: 'Watch Docs — Human Rights in Film',
    url: 'https://watchdocs.pl',
    category: 'cinema',
    venues: ['Kino Muranów', 'Kinoteka'],
    city: 'Warsaw',
    startDate: '2026-12-04',
    endDate: '2026-12-13',
    description: 'International documentary festival on human rights, with post-screening debates.',
  },
];

/**
 * Festivals worth showing "now": ongoing ones (today inside the date range)
 * and future ones, soonest first. Past editions are dropped.
 */
export function listFestivals(now: Date = new Date(), category?: FestivalCategory): Festival[] {
  // Compare on the Warsaw calendar day so a festival's last evening still
  // counts as ongoing everywhere the server might run.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(now);
  return FESTIVAL_SEEDS.filter((f) => f.endDate >= today)
    // Undefined means "every listing" — the unfiltered home view. An explicit
    // category narrows to that listing's own festivals (GOI-68).
    .filter((f) => category === undefined || f.category === category)
    .map<Festival>((f) => ({
      ...f,
      url: f.url ?? null,
      imageUrl: f.imageUrl ?? null,
      status: f.startDate <= today ? 'ongoing' : 'upcoming',
    }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}
