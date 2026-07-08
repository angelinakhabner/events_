import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClosestScreenings } from './ClosestScreenings';
import type { Event } from '@goin/shared';

const useQueryMock = vi.fn();
vi.mock('../lib/trpc', () => ({
  trpc: {
    events: {
      screenings: {
        useQuery: (...args: unknown[]) => useQueryMock(...args),
      },
    },
  },
}));

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

beforeEach(() => {
  useQueryMock.mockReset();
  useQueryMock.mockReturnValue({ data: [], isLoading: false, isError: false });
});

describe('ClosestScreenings', () => {
  it('non-cinema events get a "Nearest dates" button that lists other venues', () => {
    const event = makeEvent({
      category: 'theatre', title: 'Dziady',
      venue: { id: 'v1', name: 'Teatr Powszechny', category: 'theatre', city: 'Warsaw', country: 'PL' },
    });
    useQueryMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [
        makeEvent({
          id: 'e9', venueId: 'v9', category: 'theatre', title: 'Dziady',
          sourceUrl: 'https://nowy.example/e9',
          startsAt: '2026-07-06T19:00:00.000Z',
          venue: { id: 'v9', name: 'Nowy Teatr', category: 'theatre', city: 'Warsaw', country: 'PL' },
        }),
      ],
    });

    render(<ClosestScreenings event={event} />);
    fireEvent.click(screen.getByRole('button', { name: /nearest dates/i }));
    expect(useQueryMock).toHaveBeenCalledWith({ title: 'Dziady' });

    const [link] = screen.getAllByRole('link');
    expect(link).toHaveAttribute('href', 'https://nowy.example/e9');
    expect(link).toHaveTextContent('Nowy Teatr');
  });

  it('only queries once the button is clicked, using the film title', () => {
    render(<ClosestScreenings event={makeEvent()} />);
    expect(useQueryMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));
    expect(useQueryMock).toHaveBeenCalledWith({ title: 'Ojczyzna' });
  });

  it('lists screenings at other cinemas, excluding the row you clicked from', () => {
    const event = makeEvent();
    useQueryMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [
        event, // the current screening comes back too — must be filtered out
        makeEvent({
          id: 'e2', venueId: 'v2', sourceUrl: 'https://kinoteka.example/e2',
          startsAt: '2026-07-04T20:30:00.000Z',
          venue: { id: 'v2', name: 'Kinoteka', category: 'cinema', city: 'Warsaw', country: 'PL' },
        }),
        makeEvent({
          id: 'e3', venueId: 'v3', sourceUrl: 'https://iluzjon.example/e3',
          startsAt: '2026-07-05T16:00:00.000Z',
          venue: { id: 'v3', name: 'Iluzjon', category: 'cinema', city: 'Warsaw', country: 'PL' },
        }),
      ],
    });

    render(<ClosestScreenings event={event} />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', 'https://kinoteka.example/e2');
    expect(links[0]).toHaveTextContent('Kinoteka');
    expect(links[1]).toHaveTextContent('Iluzjon');
  });

  it('keeps every cinema visible by grouping repeat showings into one row', () => {
    const event = makeEvent();
    useQueryMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [
        event,
        // Kinoteka screens the film three times before Iluzjon's first showing —
        // chronological order, as the API returns it.
        makeEvent({
          id: 'k1', venueId: 'v2', sourceUrl: 'https://kinoteka.example/k1',
          startsAt: '2026-07-04T19:00:00.000Z',
          venue: { id: 'v2', name: 'Kinoteka', category: 'cinema', city: 'Warsaw', country: 'PL' },
        }),
        makeEvent({
          id: 'k2', venueId: 'v2', sourceUrl: 'https://kinoteka.example/k2',
          startsAt: '2026-07-04T21:00:00.000Z',
          venue: { id: 'v2', name: 'Kinoteka', category: 'cinema', city: 'Warsaw', country: 'PL' },
        }),
        makeEvent({
          id: 'k3', venueId: 'v2', sourceUrl: 'https://kinoteka.example/k3',
          startsAt: '2026-07-05T19:00:00.000Z',
          venue: { id: 'v2', name: 'Kinoteka', category: 'cinema', city: 'Warsaw', country: 'PL' },
        }),
        makeEvent({
          id: 'i1', venueId: 'v3', sourceUrl: 'https://iluzjon.example/i1',
          startsAt: '2026-07-06T16:00:00.000Z',
          venue: { id: 'v3', name: 'Iluzjon', category: 'cinema', city: 'Warsaw', country: 'PL' },
        }),
      ],
    });

    render(<ClosestScreenings event={event} />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));

    // One row per venue: Kinoteka collapses to its next showing (+2 more),
    // Iluzjon still gets its own row instead of being pushed out.
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', 'https://kinoteka.example/k1');
    expect(links[0]).toHaveTextContent('Kinoteka');
    expect(links[0]).toHaveTextContent('+2 more');
    expect(links[1]).toHaveAttribute('href', 'https://iluzjon.example/i1');
    expect(links[1]).toHaveTextContent('Iluzjon');
  });

  it('offers later showings at the same venue you clicked from', () => {
    const event = makeEvent(); // 18:00 at Kino Muranów
    useQueryMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [
        event,
        makeEvent({ id: 'm2', sourceUrl: 'https://muranow.example/m2', startsAt: '2026-07-04T21:15:00.000Z' }),
      ],
    });

    render(<ClosestScreenings event={event} />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));

    const [link] = screen.getAllByRole('link');
    expect(link).toHaveAttribute('href', 'https://muranow.example/m2');
    expect(link).toHaveTextContent('Kino Muranów');
  });

  it('says so when there are no other screenings', () => {
    const event = makeEvent();
    useQueryMock.mockReturnValue({ data: [event], isLoading: false, isError: false });

    render(<ClosestScreenings event={event} />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));

    expect(screen.getByText(/no other upcoming screenings/i)).toBeInTheDocument();
  });

  it('shows a loading state while the query is in flight', () => {
    useQueryMock.mockReturnValue({ data: undefined, isLoading: true, isError: false });

    render(<ClosestScreenings event={makeEvent()} />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));

    expect(screen.getByText(/looking for screenings/i)).toBeInTheDocument();
  });
});
