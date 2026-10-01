import type { Event } from '@afisz/shared';
import { DEFAULT_VENUES } from './default-venues.js';

// Deterministic mock event set, derived from the seeded venues so the
// shape is real. Replace with the scraper+AI pipeline once wired.
const TEMPLATES: Array<{ venueId: string; offsetDays: number; hour: number; title: string; description: string; durationMinutes: number | null; priceMin: number | null; priceMax: number | null; genre: string | null; director: string | null }> = [
  { venueId: 'kino-muranow', offsetDays: 0, hour: 18, title: 'Perfect Days', description: 'Wyciszony portret tokijskiego sprzątacza toalet w reżyserii Wima Wendersa.', durationMinutes: 124, priceMin: 28, priceMax: 32, genre: 'Drama', director: 'Wim Wenders' },
  { venueId: 'kino-muranow', offsetDays: 1, hour: 20, title: 'Anatomy of a Fall', description: 'Nagrodzony Złotą Palmą thriller sądowy Justine Triet.', durationMinutes: 151, priceMin: 28, priceMax: 32, genre: 'Drama', director: 'Justine Triet' },
  { venueId: 'kino-muranow', offsetDays: 3, hour: 19, title: 'The Zone of Interest', description: 'Rodzina mieszka tuż za murem Auschwitz.', durationMinutes: 105, priceMin: 28, priceMax: 32, genre: 'Drama', director: 'Jonathan Glazer' },
  { venueId: 'teatr-powszechny', offsetDays: 1, hour: 19, title: 'Sprawa', description: 'Nowy polityczny dramat duetu Strzępka i Demirski.', durationMinutes: 180, priceMin: 60, priceMax: 120, genre: 'Theatre', director: 'Monika Strzępka' },
  { venueId: 'teatr-powszechny', offsetDays: 4, hour: 19, title: 'Dziady', description: 'Mickiewicz odczytany na nowo dla współczesnej sceny.', durationMinutes: 210, priceMin: 60, priceMax: 140, genre: 'Theatre', director: null },
  { venueId: 'zacheta', offsetDays: 0, hour: 12, title: 'After the Future', description: 'Wystawa zbiorowa o spekulatywnych ekologiach.', durationMinutes: null, priceMin: 0, priceMax: 25, genre: 'Exhibition', director: null },
  { venueId: 'zacheta', offsetDays: 2, hour: 12, title: 'Magdalena Abakanowicz — Soft Forms', description: 'Retrospektywa tkanych prac rzeźbiarki.', durationMinutes: null, priceMin: 0, priceMax: 25, genre: 'Exhibition', director: null },
  { venueId: 'klub-komediowy', offsetDays: 2, hour: 20, title: 'Open Mic Night', description: 'Najdłużej działający open mic stand-upowy w Warszawie.', durationMinutes: 90, priceMin: 30, priceMax: 30, genre: 'Comedy', director: null },
  { venueId: 'klub-komediowy', offsetDays: 5, hour: 21, title: 'Headliners Showcase', description: 'Wybrani wykonawcy z lokalnej sceny.', durationMinutes: 120, priceMin: 50, priceMax: 70, genre: 'Comedy', director: null },
];

const EPOCH = new Date('2026-06-01T00:00:00.000Z').getTime();

export function generateDefaultEvents(now: Date = new Date()): Event[] {
  // Anchor to a fixed epoch so dev/test output is deterministic.
  const baseMidnight = new Date(Math.max(EPOCH, now.getTime()));
  baseMidnight.setUTCHours(0, 0, 0, 0);
  const venueById = new Map(DEFAULT_VENUES.map((v) => [v.id, v]));

  return TEMPLATES.map((t, i): Event => {
    const start = new Date(baseMidnight.getTime() + t.offsetDays * 24 * 60 * 60 * 1000);
    start.setUTCHours(t.hour, 0, 0, 0);
    const venue = venueById.get(t.venueId);
    return {
      id: `evt-${i + 1}`,
      venueId: t.venueId,
      title: t.title,
      description: t.description,
      startsAt: start.toISOString(),
      endsAt: t.durationMinutes ? new Date(start.getTime() + t.durationMinutes * 60_000).toISOString() : null,
      durationMinutes: t.durationMinutes,
      director: t.director,
      cast: [],
      category: venue?.category ?? 'other',
      language: venue?.language ?? null,
      priceMin: t.priceMin,
      priceMax: t.priceMax,
      sourceUrl: venue?.url ?? '',
      sourceId: null,
      scrapedAt: baseMidnight.toISOString(),
    };
  });
}
