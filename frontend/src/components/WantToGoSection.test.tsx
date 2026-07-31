import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WantToGoSection, mergeRows } from './WantToGoSection';
import type { Event, Film, WantToGoEntry } from '@afisz/shared';

const entriesMock = vi.fn();
const filmsMock = vi.fn();
const screeningsMock = vi.fn();

/** Every mutation the section can fire, stubbed to a no-op that records input. */
function stubMutation() {
  return {
    useMutation: (opts?: { onSuccess?: () => void }) => ({
      mutate: (input: unknown) => { void input; opts?.onSuccess?.(); },
      isPending: false,
      isSuccess: false,
      error: null,
    }),
  };
}

vi.mock('../lib/auth', () => ({ isLoggedIn: () => true }));
vi.mock('../lib/trpc', () => {
  const invalidate = () => Promise.resolve();
  return {
    trpc: {
      useUtils: () => ({
        my: {
          wantToGo: {
            entries: { invalidate },
            ids: { invalidate },
            list: { invalidate },
          },
          films: { list: { invalidate } },
        },
      }),
      events: { screenings: { useQuery: (...a: unknown[]) => screeningsMock(...a) } },
      my: {
        wantToGo: {
          entries: { useQuery: () => entriesMock() },
          setSeen: stubMutation(),
          remove: stubMutation(),
        },
        films: {
          list: { useQuery: () => filmsMock() },
          add: stubMutation(),
          moveToWant: stubMutation(),
          remove: stubMutation(),
          markSeen: stubMutation(),
        },
      },
    },
  };
});

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'e1', venueId: 'v1',
    venue: { id: 'v1', name: 'Kino Muranów', category: 'cinema', city: 'Warsaw', country: 'PL' },
    title: 'Ojczyzna', description: null,
    startsAt: '2026-07-04T18:00:00.000Z', endsAt: null, durationMinutes: 110, director: null, cast: [],
    category: 'cinema', language: 'pl',
    priceMin: null, priceMax: null, sourceUrl: 'https://muranow.example/e1', sourceId: null, scrapedAt: '',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<WantToGoEntry> = {}): WantToGoEntry {
  return { event: makeEvent(), seenAt: null, savedAt: '2026-07-01T10:00:00.000Z', ...overrides };
}

function makeFilm(overrides: Partial<Film> = {}): Film {
  return {
    id: 'f1', title: 'Vertigo', status: 'want',
    watchedVenue: null, comment: null, watchedAt: null,
    createdAt: '2026-07-02T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  entriesMock.mockReset().mockReturnValue({ data: [], isLoading: false, error: null });
  filmsMock.mockReset().mockReturnValue({ data: [], isLoading: false, error: null });
  screeningsMock.mockReset().mockReturnValue({ data: [], isLoading: false, isError: false });
});

// GOI-46: a saved event stands for the *title*. The row shows no date or time
// — every date lives behind "Nearest screenings", which stays useful after the
// showing you clicked from has passed.
describe('WantToGoSection — saved events carry no date', () => {
  it('shows the title with its kind, and no date or time', () => {
    entriesMock.mockReturnValue({ data: [makeEntry()], isLoading: false, error: null });

    render(<WantToGoSection />);

    expect(screen.getByRole('link', { name: 'Ojczyzna' })).toHaveAttribute(
      'href',
      'https://muranow.example/e1',
    );
    expect(screen.getByText('film')).toBeInTheDocument();
    // The saved showing was 20:00 on 4 July Warsaw — neither may appear.
    expect(screen.queryByText(/4 Jul/)).not.toBeInTheDocument();
    expect(screen.queryByText(/20:00/)).not.toBeInTheDocument();
  });

  it('names non-film categories by their own word', () => {
    entriesMock.mockReturnValue({
      data: [makeEntry({ event: makeEvent({ category: 'theatre', title: 'Dziady' }) })],
      isLoading: false,
      error: null,
    });

    render(<WantToGoSection />);
    expect(screen.getByText('theatre')).toBeInTheDocument();
  });

  it('offers the screenings panel, showing the saved showing itself', () => {
    entriesMock.mockReturnValue({ data: [makeEntry()], isLoading: false, error: null });
    screeningsMock.mockReturnValue({
      // Only the saved showing exists; an event card would hide it as "the one
      // you're on", but here it is the only date the user can see.
      data: [makeEvent()],
      isLoading: false,
      isError: false,
    });

    render(<WantToGoSection />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));

    expect(screen.getByText('Kino Muranów')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '20:00' })).toBeInTheDocument();
  });

  it('drops the screenings panel once an entry is marked seen', () => {
    entriesMock.mockReturnValue({
      data: [makeEntry({ seenAt: '2026-07-05T10:00:00.000Z' })],
      isLoading: false,
      error: null,
    });

    render(<WantToGoSection />);
    fireEvent.click(screen.getByRole('tab', { name: /seen/i }));

    expect(screen.getByRole('link', { name: 'Ojczyzna' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /nearest screenings/i })).not.toBeInTheDocument();
  });
});

describe('mergeRows', () => {
  // Nothing on the list has a start time any more, so "soonest first" has no
  // meaning: both kinds sort by when they were saved, newest first.
  it('interleaves events and films by save time, newest first', () => {
    const rows = mergeRows(
      [
        makeEntry({ event: makeEvent({ id: 'old' }), savedAt: '2026-07-01T10:00:00.000Z' }),
        makeEntry({ event: makeEvent({ id: 'new' }), savedAt: '2026-07-03T10:00:00.000Z' }),
      ],
      [makeFilm({ createdAt: '2026-07-02T10:00:00.000Z' })],
    );

    expect(rows.map((r) => r.key)).toEqual(['event-new', 'film-f1', 'event-old']);
  });

  it('marks seen entries and watched films alike', () => {
    const rows = mergeRows(
      [makeEntry({ seenAt: '2026-07-05T10:00:00.000Z' })],
      [makeFilm({ status: 'seen' })],
    );
    expect(rows.every((r) => r.seen)).toBe(true);
  });
});
