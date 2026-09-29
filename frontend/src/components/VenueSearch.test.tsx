import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Event } from '@afisz/shared';
import { VenueSearch } from './VenueSearch';

/**
 * GOI-112: search across venues.
 *
 * The two answers are what matters. When something is on, it is listed with
 * where and when. When nothing is, the title can go on the list — which is the
 * answer the feature exists for, and the one an ordinary search gives up on.
 */
let searchState: Record<string, unknown>;
let addState: Record<string, unknown>;
const addMutate = vi.fn();
const addReset = vi.fn();
let lastSearchInput: { q: string } | null = null;

vi.mock('../lib/trpc', () => ({
  trpc: {
    events: {
      search: {
        useQuery: (input: { q: string }) => {
          lastSearchInput = input;
          return searchState;
        },
      },
      screenings: { useQuery: () => ({ data: [], isLoading: false, error: null }) },
    },
    my: {
      wantToGo: {
        ids: { useQuery: () => ({ data: [] }) },
        add: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        remove: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
      films: {
        add: { useMutation: () => ({ mutate: addMutate, reset: addReset, ...addState }) },
      },
    },
    useUtils: () => ({ my: { wantToGo: { ids: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } } } }),
  },
}));

vi.mock('../lib/auth', () => ({ isLoggedIn: () => false }));

const idle = { isPending: false, isSuccess: false, isLoading: false, data: undefined, error: null };

const screening: Event = {
  id: 'e1',
  venueId: 'v1',
  title: 'Chungking Express',
  description: null,
  startsAt: '2026-09-20T18:00:00+02:00',
  endsAt: null,
  category: 'cinema',
  language: null,
  director: null,
  cast: [],
  durationMinutes: null,
  priceMin: null,
  priceMax: null,
  sourceUrl: 'https://kino.test/e1',
  sourceId: null,
  scrapedAt: '2026-09-01T00:00:00Z',
  venue: { id: 'v1', name: 'Kino Muranów', category: 'cinema', city: 'Warsaw', country: 'PL' },
};

beforeEach(() => {
  searchState = { ...idle };
  addState = { ...idle };
  addMutate.mockReset();
  addReset.mockReset();
  lastSearchInput = null;
});

function setup(tracked: string[] = []) {
  const onTrack = vi.fn();
  render(<VenueSearch tracked={tracked} onTrack={onTrack} />);
  return { onTrack };
}

function search(q: string) {
  fireEvent.change(screen.getByLabelText(/search across venues/i), { target: { value: q } });
  fireEvent.click(screen.getByRole('button', { name: /^search$/i }));
}

describe('VenueSearch', () => {
  it('will not search on a single character', () => {
    setup();
    fireEvent.change(screen.getByLabelText(/search across venues/i), { target: { value: 'a' } });
    expect(screen.getByRole('button', { name: /^search$/i })).toBeDisabled();
  });

  it('lists what is on, with where and when', async () => {
    searchState = { ...idle, data: [screening] };
    setup();
    search('chungking');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Chungking Express' })).toBeInTheDocument();
    });
    expect(screen.getByText('Kino Muranów')).toBeInTheDocument();
    expect(lastSearchInput).toEqual({ q: 'chungking' });
  });

  it('offers to track a title no venue has announced', async () => {
    searchState = { ...idle, data: [] };
    setup();
    search('Nieistniejący film');

    await waitFor(() => {
      expect(screen.getByText(/nothing coming up/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /track/i }));
    expect(addMutate).toHaveBeenCalledWith({ title: 'Nieistniejący film' });
  });

  it('does not offer a title that is already on the list', async () => {
    searchState = { ...idle, data: [] };
    setup(['nieistniejący film']);
    search('Nieistniejący film');

    await waitFor(() => {
      expect(screen.getByText(/already on your list/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /track/i })).not.toBeInTheDocument();
  });

  it('says what happens next once a title is tracked', async () => {
    searchState = { ...idle, data: [] };
    addState = { ...idle, isSuccess: true };
    setup();
    search('Nieistniejący film');

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/in your brief/i);
    });
  });
});
