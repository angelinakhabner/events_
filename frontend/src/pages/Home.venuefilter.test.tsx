/**
 * GOI-94: picking venues out of the "All venues" dialog has to narrow the feed.
 *
 * The dialog itself has tests; this is about the page applying what it returns,
 * which is exactly the seam the report is on ("it opens but doesn't filter").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Event, Venue, VenueFilterOption } from '@afisz/shared';

const eventsMock = vi.fn();
const filterOptionsMock = vi.fn();
/** Every input the listing query has been called with, newest last. */
const listInputs: { venueIds?: string[] }[] = [];

vi.mock('../lib/auth', () => ({ isLoggedIn: () => false }));
vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ my: { wantToGo: { ids: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } } } }),
    events: {
      listDefault: {
        useQuery: (input: { venueIds?: string[] }) => {
          listInputs.push(input);
          return eventsMock();
        },
      },
      screenings: { useQuery: () => ({ data: [], isLoading: false, error: null }) },
      filterOptions: { useQuery: () => filterOptionsMock() },
    },
    venues: { list: { useQuery: () => ({ data: venues, isLoading: false, error: null }) } },
    festivals: { list: { useQuery: () => ({ data: [], isLoading: false, error: null }) } },
  },
}));

import { HomePage } from './Home';

const muranow: Venue = {
  id: 'v-muranow', name: 'Kino Muranów', url: 'https://muranow.example', city: 'Warsaw',
  country: 'PL', category: 'cinema', language: 'pl', timezone: 'Europe/Warsaw', createdAt: '',
};
const kinoteka: Venue = { ...muranow, id: 'v-kinoteka', name: 'Kinoteka', url: 'https://kinoteka.example' };
const venues: Venue[] = [muranow, kinoteka];

const option = (v: Venue, count: number): VenueFilterOption => ({
  id: v.id,
  slug: v.name.toLowerCase().replace(/\s+/g, '-'),
  name: v.name,
  url: v.url,
  category: 'cinema',
  count,
  status: 'active',
  lastScrapedAt: null,
});

function screening(id: string, title: string, venue: Venue): Event {
  return {
    id, title, venueId: venue.id, description: null, endsAt: null, kind: 'timed',
    category: 'cinema', language: 'pl', director: null, cast: [], durationMinutes: null,
    priceMin: null, priceMax: null, sourceUrl: `https://x.example/${id}`, sourceId: null,
    scrapedAt: '', startsAt: '2026-08-11T17:30:00.000Z',
  } as Event;
}

const atMuranow = screening('e1', 'Chungking Express', muranow);
const atKinoteka = screening('e2', 'Perfect Days', kinoteka);

const NOW = new Date('2026-08-11T10:00:00.000Z');

beforeEach(() => {
  // `changeVenues` writes the pick into the URL with `replaceState`, and jsdom
  // keeps one location for the whole file — so without this, the second test
  // starts with the first one's venue already selected and restored.
  window.history.replaceState(null, '', '/');
  listInputs.length = 0;
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  eventsMock.mockReturnValue({ data: [atMuranow, atKinoteka], isLoading: false, error: null });
  filterOptionsMock.mockReturnValue({
    data: { venues: [option(muranow, 1), option(kinoteka, 1)] },
    isLoading: false,
    error: null,
  });
});

/** Pick a category so the venue row is on screen, then open the dialog. */
async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Cinema' }));
  await user.click(screen.getByRole('button', { name: /all venues/i }));
  return screen.getByRole('dialog');
}

describe('the All venues dialog narrows the feed (GOI-94)', () => {
  it('shows both venues before anything is picked', async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    await user.click(screen.getByRole('button', { name: 'Cinema' }));

    expect(screen.getByRole('heading', { name: 'Chungking Express' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Perfect Days' })).toBeInTheDocument();
  });

  it('drops the venues left unticked once the pick is applied', async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    const dialog = await openPicker(user);

    await user.click(within(dialog).getByRole('button', { name: /^Kino Muranów, 1 event/i }));
    await user.click(within(dialog).getByRole('button', { name: /show 1 venue/i }));

    expect(screen.getByRole('heading', { name: 'Chungking Express' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Perfect Days' })).not.toBeInTheDocument();
  });

  /**
   * The substance of the fix: the pick has to reach SQL.
   *
   * Applied in the browser, to whichever hundred rows came back, choosing the
   * cinema that publishes eight screenings a day changed nothing visible — it
   * already filled the page — and choosing a sparse one emptied the feed
   * instead of narrowing it. Both read as "the picker doesn't work", and both
   * are the row cap the file's own comment describes for categories.
   */
  it('asks the server for the chosen venues, not just the browser', async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    const dialog = await openPicker(user);

    expect(listInputs.at(-1)?.venueIds).toBeUndefined();

    await user.click(within(dialog).getByRole('button', { name: /^Kino Muranów, 1 event/i }));
    await user.click(within(dialog).getByRole('button', { name: /show 1 venue/i }));

    expect(listInputs.at(-1)?.venueIds).toEqual(['v-muranow']);
  });

  it('asks for everything again once the pick is cleared', async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    const dialog = await openPicker(user);
    await user.click(within(dialog).getByRole('button', { name: /^Kino Muranów, 1 event/i }));
    await user.click(within(dialog).getByRole('button', { name: /show 1 venue/i }));

    const again = await openPicker(user);
    await user.click(within(again).getByRole('button', { name: /^all venues$/i }));
    await user.click(within(again).getByRole('button', { name: /show all venues/i }));

    // Absent, not an empty array: an explicitly empty selection would mean
    // "no venues" to the store, and this means "every venue".
    expect(listInputs.at(-1)?.venueIds).toBeUndefined();
  });

  it('puts them all back on "Show all venues"', async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    const dialog = await openPicker(user);

    await user.click(within(dialog).getByRole('button', { name: /^Kino Muranów, 1 event/i }));
    await user.click(within(dialog).getByRole('button', { name: /show 1 venue/i }));
    expect(screen.queryByRole('heading', { name: 'Perfect Days' })).not.toBeInTheDocument();

    const again = await openPicker(user);
    await user.click(within(again).getByRole('button', { name: /^all venues$/i }));
    await user.click(within(again).getByRole('button', { name: /show all venues/i }));

    expect(screen.getByRole('heading', { name: 'Perfect Days' })).toBeInTheDocument();
  });
});
