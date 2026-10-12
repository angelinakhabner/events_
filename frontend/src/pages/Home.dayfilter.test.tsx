/**
 * The day strip, through the page (GOI-88).
 *
 * Two things broke it, and both need the page to show: the listing's rows
 * arrive nearest-first under a server limit, so narrowing them in the browser
 * answered "nothing on Friday" for any Friday past the limit; and a filtered
 * day whose events had all already started bucketed to nothing, drawing a
 * blank page under a chip that looked pressed.
 *
 * The tRPC mock is a small fake server rather than a fixed payload, because
 * the fix is exactly *where* the narrowing happens — a mock that ignored the
 * input would pass whether or not the query asks for the right rows.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Event, Venue } from '@afisz/shared';

interface ListInput { filters?: { categories?: string[] }; fromDay?: string }

const requests: ListInput[] = [];
let rows: Event[] = [];

/** The feed's row limit, shrunk to the size of the fixtures so the test can
 *  reach past it the way a real cinema-heavy day does. */
const FEED_LIMIT = 3;

/** Stands in for `events.listDefault`: nearest-first, cut at the limit, and
 *  starting at `fromDay` when the caller asks for one. */
function listDefault(input?: ListInput) {
  requests.push(input ?? {});
  const ordered = [...rows].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const from = input?.fromDay;
  const scoped = from ? ordered.filter((e) => warsawDay(e.startsAt) >= from) : ordered;
  return { data: scoped.slice(0, FEED_LIMIT), isLoading: false, error: null, refetch: vi.fn() };
}

function warsawDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

vi.mock('../lib/auth', () => ({ isLoggedIn: () => false }));
vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ my: { wantToGo: { ids: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } } } }),
    events: {
      listDefault: { useQuery: (input?: ListInput) => listDefault(input) },
      screenings: { useQuery: () => ({ data: [], isLoading: false, error: null }) },
      filterOptions: { useQuery: () => ({ data: { venues: [] }, isLoading: false, error: null }) },
    },
    venues: { list: { useQuery: () => ({ data: venues, isLoading: false, error: null }) } },
    festivals: { list: { useQuery: () => ({ data: [], isLoading: false, error: null }) } },
  },
}));

import { HomePage } from './Home';

const kino: Venue = {
  id: 'v-kino', name: 'Kino Przykładowe', url: 'https://kino.example', city: 'Warsaw',
  country: 'PL', category: 'cinema', language: 'pl', timezone: 'Europe/Warsaw', createdAt: '',
};
const venues: Venue[] = [kino];

function film(id: string, startsAt: string): Event {
  return {
    id, venueId: kino.id, title: id, description: null, startsAt, endsAt: null,
    category: 'cinema', kind: 'timed', language: 'pl', director: null, cast: [],
    durationMinutes: null, priceMin: null, priceMax: null,
    sourceUrl: `https://kino.example/${id}`, sourceId: null, scrapedAt: '',
  };
}

// "Now" is Tue 18 Aug 2026, 12:00 Warsaw.
const NOW = new Date('2026-08-18T10:00:00.000Z');

/** Three showings today and tomorrow — exactly the feed's limit — then a gap,
 *  a Friday, and something the week after. The Friday is the row the old
 *  browser-side filter could never see. */
const TODAY_LATE = film('Dzis wieczorem', '2026-08-18T16:00:00.000Z');   // Tue 18:00
const TODAY_NIGHT = film('Dzis nocą', '2026-08-18T19:00:00.000Z');       // Tue 21:00
const TOMORROW = film('Jutro', '2026-08-19T16:00:00.000Z');              // Wed 18:00
const FRIDAY = film('W piątek', '2026-08-21T16:00:00.000Z');             // Fri 18:00
const NEXT_WEEK = film('Za tydzień', '2026-08-26T16:00:00.000Z');        // Wed 26th

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  requests.length = 0;
  rows = [TODAY_LATE, TODAY_NIGHT, TOMORROW, FRIDAY, NEXT_WEEK];
});

afterEach(() => {
  vi.useRealTimers();
});

function titles(): string[] {
  return screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent ?? '');
}

describe('the day strip (GOI-88)', () => {
  it('shows the nearest events when no day is selected', () => {
    render(<HomePage />);
    expect(titles()).toEqual(['Dzis wieczorem', 'Dzis nocą', 'Jutro']);
  });

  it('"Today" keeps today and drops the rest', async () => {
    const user = userEvent.setup();
    render(<HomePage />);

    await user.click(screen.getByRole('button', { name: 'Today' }));

    expect(titles()).toEqual(['Dzis wieczorem', 'Dzis nocą']);
    expect(screen.queryByText(/Next event on/)).not.toBeInTheDocument();
  });

  it('"Tomorrow" keeps tomorrow and drops today', async () => {
    const user = userEvent.setup();
    render(<HomePage />);

    await user.click(screen.getByRole('button', { name: 'Tomorrow' }));

    expect(titles()).toEqual(['Jutro']);
  });

  it('"This week" spans the seven-day window and stops there', async () => {
    const user = userEvent.setup();
    render(<HomePage />);

    await user.click(screen.getByRole('button', { name: 'This week' }));

    // Tue 18th through Mon 24th: the Friday is in, the 26th is not.
    expect(titles()).toEqual(['Dzis wieczorem', 'Dzis nocą', 'Jutro']);
    expect(screen.queryByRole('heading', { name: 'Za tydzień' })).not.toBeInTheDocument();
  });

  it('reaches a day the feed\'s own row limit stops short of', async () => {
    const user = userEvent.setup();
    render(<HomePage />);

    // The nearest three rows end on Wednesday, so filtering them in the
    // browser could only ever answer "nothing on Friday".
    await user.click(screen.getByRole('button', { name: 'Fri 21 Aug' }));

    expect(requests.at(-1)).toMatchObject({ fromDay: '2026-08-21' });
    expect(titles()).toEqual(['W piątek']);
  });

  it('names the next date and shows it when the chosen day is empty', async () => {
    const user = userEvent.setup();
    render(<HomePage />);

    // Nothing at all on the Thursday.
    await user.click(screen.getByRole('button', { name: 'Thu 20 Aug' }));

    expect(screen.getByText('Next event on Fri 21 Aug')).toBeInTheDocument();
    expect(screen.getByText(/Nothing on Thu 20 Aug/)).toBeInTheDocument();
    // …and the nearest events themselves, not just the sentence. The feed's
    // own rule still decides how far they run: Friday is inside the week, so
    // the 26th stays out of a "what's on now" listing (GOI-82).
    expect(titles()).toEqual(['W piątek']);
    // Never the dead-end empty state.
    expect(screen.queryByText(/No upcoming events/)).not.toBeInTheDocument();
  });

  it('says "today" and "this week" in the reader\'s own words', async () => {
    const user = userEvent.setup();
    rows = [NEXT_WEEK];
    render(<HomePage />);

    await user.click(screen.getByRole('button', { name: 'This week' }));
    expect(screen.getByText(/Nothing this week/)).toBeInTheDocument();
    expect(screen.getByText('Next event on Wed 26 Aug')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByText(/Nothing today/)).toBeInTheDocument();
  });

  it('answers "Today" with the next date once the day is over, not a blank page', async () => {
    // 23:00 Warsaw: both of today's showings have already started.
    vi.setSystemTime(new Date('2026-08-18T21:00:00.000Z'));
    const user = userEvent.setup();
    render(<HomePage />);

    await user.click(screen.getByRole('button', { name: 'Today' }));

    expect(screen.getByText('Next event on Wed 19 Aug')).toBeInTheDocument();
    expect(titles()).toEqual(['Jutro']);
  });

  it('falls back to the empty state when there is nothing after the day either', async () => {
    const user = userEvent.setup();
    rows = [TODAY_LATE];
    render(<HomePage />);

    await user.click(screen.getByRole('button', { name: 'Tomorrow' }));

    expect(screen.getByText('No upcoming events match your selection.')).toBeInTheDocument();
    expect(screen.queryByText(/Next event on/)).not.toBeInTheDocument();
  });

  it('"Any day" puts the whole feed back', async () => {
    const user = userEvent.setup();
    render(<HomePage />);

    await user.click(screen.getByRole('button', { name: 'Fri 21 Aug' }));
    await user.click(screen.getByRole('button', { name: 'Any day' }));

    expect(requests.at(-1)?.fromDay).toBeUndefined();
    expect(titles()).toEqual(['Dzis wieczorem', 'Dzis nocą', 'Jutro']);
  });
});
