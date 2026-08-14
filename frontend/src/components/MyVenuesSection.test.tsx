import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MyVenuesSection, scrapeRunSummary } from './MyVenuesSection';
import type { Event, ScrapeRun } from '@afisz/shared';

const venuesMock = vi.fn();
const listsMock = vi.fn();
const activityMock = vi.fn();
const byVenueMock = vi.fn();
const refreshMock = vi.fn();

const invalidateActivity = vi.fn();
const invalidateByVenue = vi.fn();

/** A mutation stub that records its input and runs onSuccess synchronously. */
function stubMutation() {
  return {
    useMutation: (opts?: { onSuccess?: () => void }) => ({
      mutate: (input: unknown) => { void input; opts?.onSuccess?.(); },
      isPending: false,
      isSuccess: false,
      data: undefined,
      error: null,
    }),
  };
}

vi.mock('../lib/trpc', () => {
  const invalidate = () => Promise.resolve();
  return {
    trpc: {
      useUtils: () => ({
        my: {
          venues: {
            list: { invalidate },
            listAll: { invalidate },
            activity: { invalidate: invalidateActivity },
          },
          lists: { list: { invalidate } },
        },
        events: { listByVenue: { invalidate: invalidateByVenue } },
      }),
      events: { listByVenue: { useQuery: (...a: unknown[]) => byVenueMock(...a) } },
      my: {
        venues: {
          listAll: { useQuery: () => venuesMock() },
          activity: { useQuery: () => activityMock() },
          add: stubMutation(),
          update: stubMutation(),
          remove: stubMutation(),
          refresh: { useMutation: (...a: unknown[]) => refreshMock(...a) },
        },
        lists: {
          list: { useQuery: () => listsMock() },
          setActive: stubMutation(),
          create: stubMutation(),
          rename: stubMutation(),
          remove: stubMutation(),
        },
      },
    },
  };
});

const venue = {
  id: 'v1',
  name: 'Teatr Studio',
  url: 'https://teatrstudio.pl',
  category: 'theatre' as const,
  windowDays: null,
  customized: false,
  listId: 'l1',
  tags: [],
};

const event: Event = {
  id: 'e1',
  venueId: 'v1',
  venue: { id: 'v1', name: 'Teatr Studio', category: 'theatre', city: 'Warsaw', country: 'PL' },
  title: 'Wesele',
  description: null,
  startsAt: '2026-09-01T17:00:00.000Z',
  endsAt: null,
  durationMinutes: null,
  director: null,
  cast: [],
  category: 'theatre',
  language: 'pl',
  priceMin: null,
  priceMax: null,
  sourceUrl: 'https://teatrstudio.pl/wesele',
  sourceId: null,
  scrapedAt: '',
};

/** The default mutation shape; individual tests override what they care about. */
function refreshState(over: Partial<{ isPending: boolean; data: ScrapeRun | undefined; error: { message: string } | null }> = {}) {
  return (opts?: { onSuccess?: () => void }) => ({
    mutate: vi.fn(() => opts?.onSuccess?.()),
    isPending: false,
    data: undefined,
    error: null,
    ...over,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  venuesMock.mockReturnValue({ data: [venue], isLoading: false, error: null });
  listsMock.mockReturnValue({ data: [{ id: 'l1', name: 'Warsaw', active: true, venueCount: 1 }] });
  activityMock.mockReturnValue({ data: [] });
  byVenueMock.mockReturnValue({ data: [event], isLoading: false, isError: false });
  refreshMock.mockImplementation(refreshState());
});

describe('MyVenuesSection — refresh / show upcoming (GOI-75)', () => {
  it('scrapes just that venue when Refresh is clicked, and invalidates what the run changed', () => {
    const mutate = vi.fn();
    refreshMock.mockImplementation((opts?: { onSuccess?: () => void }) => ({
      mutate: (input: unknown) => { mutate(input); opts?.onSuccess?.(); },
      isPending: false,
      data: undefined,
      error: null,
    }));

    render(<MyVenuesSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(mutate).toHaveBeenCalledWith({ venueId: 'v1' });
    expect(invalidateActivity).toHaveBeenCalled();
    expect(invalidateByVenue).toHaveBeenCalledWith({ venueId: 'v1' });
  });

  it('opens the upcoming panel once a refresh comes back, without a second click', () => {
    render(<MyVenuesSection />);
    expect(screen.queryByText('Wesele')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(screen.getByText('Wesele')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide upcoming' })).toBeInTheDocument();
  });

  it('toggles the venue’s upcoming events on demand', () => {
    render(<MyVenuesSection />);
    const toggle = screen.getByRole('button', { name: 'Show upcoming' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    const link = screen.getByRole('link', { name: 'Wesele' });
    expect(link).toHaveAttribute('href', 'https://teatrstudio.pl/wesele');

    fireEvent.click(screen.getByRole('button', { name: 'Hide upcoming' }));
    expect(screen.queryByText('Wesele')).not.toBeInTheDocument();
  });

  it('points an empty venue at the Refresh button rather than leaving a blank panel', () => {
    byVenueMock.mockReturnValue({ data: [], isLoading: false, isError: false });
    render(<MyVenuesSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Show upcoming' }));
    expect(screen.getByText(/nothing upcoming/i)).toBeInTheDocument();
  });

  it('reports a failed scrape on the row it belongs to', () => {
    refreshMock.mockImplementation(
      refreshState({
        data: {
          id: 'r1', venueId: 'v1', startedAt: '', finishedAt: null,
          status: 'failed', eventsFound: null, errorMessage: 'HTTP 403', rawHash: null,
        },
      }),
    );
    render(<MyVenuesSection />);
    expect(screen.getByText(/scrape failed: http 403/i)).toBeInTheDocument();
  });

  it('disables Refresh while the scrape is in flight', () => {
    refreshMock.mockImplementation(refreshState({ isPending: true }));
    render(<MyVenuesSection />);
    expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeDisabled();
    expect(screen.getByText(/scraping teatr studio/i)).toBeInTheDocument();
  });
});

describe('scrapeRunSummary', () => {
  const run = (over: Partial<ScrapeRun>): ScrapeRun => ({
    id: 'r', venueId: 'v', startedAt: '', finishedAt: null,
    status: 'success', eventsFound: 0, errorMessage: null, rawHash: null,
    ...over,
  });

  it('counts what a successful run found, singular and plural', () => {
    expect(scrapeRunSummary(run({ eventsFound: 1 }))).toBe('Found 1 event.');
    expect(scrapeRunSummary(run({ eventsFound: 12 }))).toBe('Found 12 events.');
  });

  it('distinguishes "read nothing" from "nothing to re-read" and from an error', () => {
    expect(scrapeRunSummary(run({ status: 'success_empty' }))).toMatch(/no events could be read/i);
    expect(scrapeRunSummary(run({ status: 'skipped_unchanged' }))).toMatch(/hasn’t changed/i);
    expect(scrapeRunSummary(run({ status: 'failed', errorMessage: 'boom' }))).toBe('Scrape failed: boom');
  });

  it('names the error even when the run recorded none', () => {
    expect(scrapeRunSummary(run({ status: 'failed' }))).toBe('Scrape failed: unknown error');
  });
});
