import type { Festival } from '@afisz/shared';

// Curated film-festival calendar for the cinemas AFISZ covers (GOI-6). Edit
// this file to add or correct entries — dates are inclusive ISO days. The API
// (festivals.list) filters out past editions and computes ongoing/upcoming
// server-side, so the frontend never needs date logic.

export interface FestivalSeed {
  id: string;
  name: string;
  url: string;
  cinemas: string[];
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
    cinemas: ['Plac Zabaw', 'Boulevards of the Vistula'],
    city: 'Warsaw',
    startDate: '2026-06-19',
    endDate: '2026-08-30',
    description: 'Open-air summer screenings on the Vistula boulevards — free entry, films at dusk.',
  },
  {
    id: 'wff-2026',
    name: 'Warsaw Film Festival',
    url: 'https://wff.pl',
    cinemas: ['Kinoteka', 'Kino Muranów', 'Multikino Złote Tarasy'],
    city: 'Warsaw',
    startDate: '2026-10-09',
    endDate: '2026-10-18',
    description: 'Warsaw’s flagship international festival — premieres, competitions and Q&As across the city’s big screens.',
  },
  {
    id: 'five-flavours-2026',
    name: 'Five Flavours Asian Film Festival',
    url: 'https://piecsmakow.pl',
    cinemas: ['Kino Muranów', 'Kinoteka'],
    city: 'Warsaw',
    startDate: '2026-11-11',
    endDate: '2026-11-18',
    description: 'The largest showcase of Asian cinema in Poland, from festival hits to genre discoveries.',
  },
  {
    id: 'watch-docs-2026',
    name: 'Watch Docs — Human Rights in Film',
    url: 'https://watchdocs.pl',
    cinemas: ['Kino Muranów', 'Kinoteka'],
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
export function listFestivals(now: Date = new Date()): Festival[] {
  // Compare on the Warsaw calendar day so a festival's last evening still
  // counts as ongoing everywhere the server might run.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(now);
  return FESTIVAL_SEEDS.filter((f) => f.endDate >= today)
    .map<Festival>((f) => ({ ...f, status: f.startDate <= today ? 'ongoing' : 'upcoming' }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}
