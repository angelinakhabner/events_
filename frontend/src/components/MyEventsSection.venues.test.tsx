/**
 * GOI-135: /my → Events gets the venue row the public listing has — per
 * category, the reader's own venues, and picking one narrows the list to it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Event, Venue } from '@afisz/shared';
import { myVenueOptions } from '../lib/venue-selection';

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ my: { wantToGo: { ids: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } } } }),
    my: {
      // Narrowed by category the way the server narrows it in SQL (GOI-71).
      events: {
        list: {
          useQuery: (input?: { filters?: { categories?: string[] } }) => ({
            data: input?.filters?.categories
              ? events.filter((e) => input.filters!.categories!.includes(e.category))
              : events,
            isLoading: false,
            error: null,
          }),
        },
      },
      venues: { list: { useQuery: () => ({ data: venues, isLoading: false, error: null }) } },
      wantToGo: { ids: { useQuery: () => ({ data: [] }) } },
    },
    events: { screenings: { useQuery: () => ({ data: [], isLoading: false, error: null }) } },
  },
}));

import { MyEventsSection } from './MyEventsSection';

const base: Venue = {
  id: 'v-muranow', name: 'Kino Muranów', url: 'https://muranow.example', city: 'Warsaw',
  country: 'PL', category: 'cinema', language: 'pl', timezone: 'Europe/Warsaw', createdAt: '',
};
const muranow = base;
const kinoteka: Venue = { ...base, id: 'v-kinoteka', name: 'Kinoteka', url: 'https://kinoteka.example' };
const powszechny: Venue = {
  ...base, id: 'v-powszechny', name: 'Teatr Powszechny', url: 'https://powszechny.example', category: 'theatre',
};
const venues = [muranow, kinoteka, powszechny];

function event(id: string, title: string, venue: Venue, startsAt = '2026-08-11T17:30:00.000Z'): Event {
  return {
    id, title, venueId: venue.id, description: null, endsAt: null, kind: 'timed',
    category: venue.category, language: 'pl', director: null, cast: [], durationMinutes: null,
    priceMin: null, priceMax: null, sourceUrl: `https://x.example/${id}`, sourceId: null,
    scrapedAt: '', startsAt,
    venue: { id: venue.id, name: venue.name, category: venue.category, city: 'Warsaw', country: 'PL' },
  } as Event;
}

const events: Event[] = [
  event('e1', 'Chungking Express', muranow),
  event('e2', 'Perfect Days', kinoteka),
  event('e3', 'Dziady', powszechny),
];

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-08-11T10:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

describe('MyEventsSection — venues per category (GOI-135)', () => {
  it('has no venue row on the ALL tab, as on Home', () => {
    render(<MyEventsSection />);
    expect(screen.queryByRole('group', { name: /filtruj według miejsca/i })).not.toBeInTheDocument();
  });

  it('lists the category’s own venues, and picking one narrows the list', async () => {
    const user = userEvent.setup();
    render(<MyEventsSection />);
    await user.click(screen.getByRole('button', { name: 'Kino' }));

    const row = screen.getByRole('group', { name: /filtruj według miejsca/i });
    expect(within(row).getByRole('button', { name: /^Kino Muranów, 1 wydarzenie/i })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /^Kinoteka, 1 wydarzenie/i })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /Powszechny/i })).not.toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: /^Kinoteka, 1 wydarzenie/i }));
    expect(screen.getByRole('heading', { name: 'Perfect Days' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Chungking Express' })).not.toBeInTheDocument();
  });

  it('remembers the pick per category', async () => {
    const user = userEvent.setup();
    render(<MyEventsSection />);
    await user.click(screen.getByRole('button', { name: 'Kino' }));
    const row = () => screen.getByRole('group', { name: /filtruj według miejsca/i });
    await user.click(within(row()).getByRole('button', { name: /^Kinoteka/i }));

    await user.click(screen.getByRole('button', { name: 'Teatr' }));
    expect(within(row()).getByRole('button', { name: /^Teatr Powszechny/i })).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('button', { name: 'Kino' }));
    expect(within(row()).getByRole('button', { name: /^Kinoteka/i })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('myVenueOptions', () => {
  it('counts the window, and calls a venue with nothing upcoming empty', () => {
    const quiet: Venue = { ...base, id: 'v-quiet', name: 'Iluzjon' };
    const later = event('e4', 'Later', kinoteka, '2026-08-20T17:30:00.000Z');
    const options = myVenueOptions(
      [muranow, kinoteka, quiet, powszechny],
      'cinema',
      [events[0]!, events[1]!, later],
      [events[0]!],
    );
    expect(options.map((o) => [o.name, o.count, o.status])).toEqual([
      ['Kino Muranów', 1, 'active'],
      ['Iluzjon', 0, 'empty'],
      ['Kinoteka', 0, 'active'],
    ]);
  });

  it('offers a venue filed elsewhere under a category it has events in', () => {
    const film = event('e5', 'Film night', powszechny);
    const options = myVenueOptions([muranow, powszechny], 'cinema', [film], [film]);
    expect(options.map((o) => o.name)).toEqual(['Teatr Powszechny', 'Kino Muranów']);
  });
});
