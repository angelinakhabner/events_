/**
 * The museums view, end to end through the page's own filters (GOI-67).
 *
 * The unit tests around `splitExhibitions` and `formatExhibitionRange` prove
 * the rules; this proves the page actually applies them, which is the part
 * that has broken before ("tests pass, UI still shows 16:00").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Event, Venue } from '@afisz/shared';

const eventsMock = vi.fn();

vi.mock('../lib/auth', () => ({ isLoggedIn: () => false }));
vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ my: { wantToGo: { ids: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } } } }),
    events: {
      listDefault: { useQuery: () => eventsMock() },
      screenings: { useQuery: () => ({ data: [], isLoading: false, error: null }) },
      // The venue filter row (GOI-76). These cases are about the museums
      // split, so the row has nothing to show and stays out of the way.
      filterOptions: { useQuery: () => ({ data: { venues: [] }, isLoading: false, error: null }) },
    },
    venues: { list: { useQuery: () => ({ data: venues, isLoading: false, error: null }) } },
    festivals: { list: { useQuery: () => ({ data: [], isLoading: false, error: null }) } },
  },
}));

import { HomePage } from './Home';

const museum: Venue = {
  id: 'v-museum', name: 'Muzeum Przykładowe', url: 'https://muzeum.example', city: 'Warsaw',
  country: 'PL', category: 'exhibition', language: 'pl', timezone: 'Europe/Warsaw', createdAt: '',
};
const venues: Venue[] = [museum];

function event(overrides: Partial<Event> & Pick<Event, 'id' | 'title' | 'startsAt'>): Event {
  return {
    venueId: museum.id, description: null, endsAt: null, category: 'exhibition', language: 'pl',
    director: null, cast: [], durationMinutes: null, priceMin: null, priceMax: null,
    sourceUrl: `https://muzeum.example/${overrides.id}`, sourceId: null, scrapedAt: '',
    ...overrides,
  };
}

/** A run that opened in June and closes in September. */
const run = event({
  id: 'exh',
  title: 'Trzy przestrzenie podziemne',
  kind: 'exhibition',
  startsAt: '2026-06-11T22:00:00.000Z', // 12 Jun, Warsaw
  endsAt: '2026-09-13T22:00:00.000Z',   // 14 Sep, Warsaw
  description: 'Interwencja w przestrzeni muzeum.',
});

/** A workshop this evening, i.e. a real timed row at the same museum. */
const workshop = event({
  id: 'timed',
  title: 'Warsztaty rysunku',
  kind: 'timed',
  startsAt: '2026-08-11T17:30:00.000Z', // 19:30 Warsaw, tonight
});

/** "Now" is fixed so the buckets are deterministic: 11 Aug 2026, 12:00 Warsaw. */
const NOW = new Date('2026-08-11T10:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  eventsMock.mockReturnValue({ data: [run, workshop], isLoading: false, error: null });
});

/** The "Ongoing exhibitions" section, or null when it isn't rendered. */
function exhibitionsSection(): HTMLElement | null {
  const heading = screen.queryByRole('heading', { name: 'Ongoing exhibitions' });
  return heading ? (heading.closest('section') as HTMLElement) : null;
}

describe('museums view (GOI-67)', () => {
  it('renders the timed buckets and the exhibitions section side by side', () => {
    render(<HomePage />);

    // The workshop is in a time bucket…
    expect(screen.getByRole('heading', { name: 'Later today' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Warsztaty rysunku' })).toBeInTheDocument();

    // …and the run is in its own section below, not in a bucket.
    const section = exhibitionsSection()!;
    expect(section).toBeTruthy();
    expect(within(section).getByRole('heading', { name: 'Trzy przestrzenie podziemne' }))
      .toBeInTheDocument();
    expect(within(section).getByText('1 event')).toBeInTheDocument();
  });

  it('an exhibition row shows its date range, no clock, and no "nearest dates"', () => {
    render(<HomePage />);
    const section = exhibitionsSection()!;

    expect(within(section).getByText('UNTIL 14 SEPT')).toBeInTheDocument();
    // Neither a real hour nor the "All day" placeholder the old rows carried.
    expect(within(section).queryByText(/^\d{2}:\d{2}$/)).not.toBeInTheDocument();
    expect(within(section).queryByText('All day')).not.toBeInTheDocument();
    // A continuous run has no "other dates" to offer.
    expect(within(section).queryByRole('button', { name: /nearest (dates|screenings)/i }))
      .not.toBeInTheDocument();
    // The actions that do make sense are still there.
    expect(within(section).getByRole('button', { name: /add to calendar/i })).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: /share/i })).toBeInTheDocument();
  });

  it('applying a time filter removes exhibitions from the DOM entirely', async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    expect(exhibitionsSection()).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'After 18:00' }));

    expect(exhibitionsSection()).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Trzy przestrzenie podziemne' })).not.toBeInTheDocument();
    // The 19:30 workshop passes the same filter and stays.
    expect(screen.getByRole('heading', { name: 'Warsztaty rysunku' })).toBeInTheDocument();
  });

  it('selecting a future day still shows a run whose range covers it', async () => {
    const user = userEvent.setup();
    render(<HomePage />);

    // 11 Aug 2026 is a Tuesday, so two days out is Thu 13 Aug: the workshop is
    // long over, the run is still on.
    await user.click(screen.getByRole('button', { name: 'Thu 13 Aug' }));

    expect(exhibitionsSection()).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Warsztaty rysunku' })).not.toBeInTheDocument();
  });

  it('a listing of exhibitions only renders no empty time-bucket headings', () => {
    eventsMock.mockReturnValue({ data: [run], isLoading: false, error: null });
    render(<HomePage />);

    expect(exhibitionsSection()).toBeTruthy();
    for (const label of ['Starting soon', 'Later today', 'Tomorrow', 'This week']) {
      expect(screen.queryByRole('heading', { name: label })).not.toBeInTheDocument();
    }
    // …and not the "nothing matches" state either — there *is* something on.
    expect(screen.queryByText(/No upcoming events/)).not.toBeInTheDocument();
  });
});

/**
 * GOI-104: on the museums tab, the runs lead.
 *
 * The section itself is unchanged — same heading, same closing-date gutter.
 * What changes is where it sits, and only on this one tab, so both orders are
 * asserted here: the mixed listing keeps GOI-67's placement, and the museums
 * listing inverts it.
 */
describe('museums view: ongoing exhibitions lead the tab (GOI-104)', () => {
  /** Section headings in the order they appear in the document. */
  function sectionOrder(): string[] {
    return screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent ?? '');
  }

  it('puts the exhibitions under the timed buckets on the ALL tab', () => {
    render(<HomePage />);
    expect(sectionOrder()).toEqual(['Later today', 'Ongoing exhibitions']);
  });

  it('puts them above the schedule once Museums is selected', async () => {
    const user = userEvent.setup();
    render(<HomePage />);

    await user.click(screen.getByRole('button', { name: 'Museums' }));

    // The runs first, with the closing date and nothing else…
    expect(sectionOrder()).toEqual(['Ongoing exhibitions', 'Later today']);
    const section = exhibitionsSection()!;
    expect(within(section).getByText('UNTIL 14 SEPT')).toBeInTheDocument();

    // …and the museum's other events still below, in the ordinary schedule.
    expect(screen.getByRole('heading', { name: 'Warsztaty rysunku' })).toBeInTheDocument();
  });
});
