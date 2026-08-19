import type { Festival, FestivalCategory } from '@afisz/shared';

// Curated festival calendar (GOI-6), filed by listing since GOI-68. Edit
// this file to add or correct entries — dates are inclusive ISO days. The API
// (festivals.list) filters out past editions and computes ongoing/upcoming
// server-side, so the frontend never needs date logic.

export interface FestivalSeed {
  id: string;
  name: string;
  url: string;
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
}

export const FESTIVAL_SEEDS: FestivalSeed[] = [
  {
    id: 'kino-letnie-2026',
    name: 'Kino Letnie nad Wisłą',
    url: 'https://kinoletnie.pl',
    category: 'cinema',
    venues: ['Plac Zabaw', 'Boulevards of the Vistula'],
    city: 'Warsaw',
    startDate: '2026-06-19',
    endDate: '2026-08-30',
    description: 'Open-air summer screenings on the Vistula boulevards — free entry, films at dusk.',
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
    startDate: '2026-11-11',
    endDate: '2026-11-18',
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
    endDate: '2026-12-10',
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
    .map<Festival>((f) => ({ ...f, status: f.startDate <= today ? 'ongoing' : 'upcoming' }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}
