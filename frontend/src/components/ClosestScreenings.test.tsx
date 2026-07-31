import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ClosestScreenings, groupByDay } from './ClosestScreenings';
import type { Event } from '@afisz/shared';

const useQueryMock = vi.fn();
const filmsListMock = vi.fn();
const addFilmMock = vi.fn();
/** Whether the panel thinks there's a session — drives the "Track film" row. */
let loggedIn = false;

vi.mock('../lib/auth', () => ({ isLoggedIn: () => loggedIn }));
vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ my: { films: { list: { invalidate: vi.fn() } } } }),
    events: {
      screenings: {
        useQuery: (...args: unknown[]) => useQueryMock(...args),
      },
    },
    my: {
      films: {
        list: { useQuery: () => filmsListMock() },
        add: {
          useMutation: (opts?: { onSuccess?: () => void }) => ({
            mutate: (input: { title: string }) => { addFilmMock(input); opts?.onSuccess?.(); },
            isPending: false,
            isSuccess: false,
            error: null,
          }),
        },
      },
    },
  },
}));

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'e1', venueId: 'v1',
    venue: { id: 'v1', name: 'Kino Muranów', category: 'cinema', city: 'Warsaw', country: 'PL' },
    title: 'Ojczyzna', description: null,
    // 18:00Z is 20:00 in Warsaw in July — every expectation below is the
    // Warsaw wall clock, which is what the panel prints.
    startsAt: '2026-07-04T18:00:00.000Z', endsAt: null, durationMinutes: 110, director: null, cast: [],
    category: 'cinema', language: 'pl',
    priceMin: null, priceMax: null, sourceUrl: 'https://muranow.example/e1', sourceId: null, scrapedAt: '',
    ...overrides,
  };
}

/** The day block whose heading matches — panel rows are `<li>` per day. */
function dayBlock(label: RegExp) {
  const heading = screen.getByText(label);
  return heading.closest('li') as HTMLElement;
}

beforeEach(() => {
  useQueryMock.mockReset();
  useQueryMock.mockReturnValue({ data: [], isLoading: false, isError: false });
  filmsListMock.mockReset();
  filmsListMock.mockReturnValue({ data: [] });
  addFilmMock.mockReset();
  loggedIn = false;
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
          startsAt: '2026-07-06T17:00:00.000Z',
          venue: { id: 'v9', name: 'Nowy Teatr', category: 'theatre', city: 'Warsaw', country: 'PL' },
        }),
      ],
    });

    render(<ClosestScreenings event={event} />);
    fireEvent.click(screen.getByRole('button', { name: /nearest dates/i }));
    expect(useQueryMock).toHaveBeenCalledWith({ title: 'Dziady' }, expect.anything());

    expect(screen.getByText('Nowy Teatr')).toBeInTheDocument();
    const [link] = screen.getAllByRole('link');
    expect(link).toHaveAttribute('href', 'https://nowy.example/e9');
    expect(link).toHaveTextContent('19:00');
  });

  it('only queries once the button is clicked, using the film title', () => {
    render(<ClosestScreenings event={makeEvent()} />);
    expect(useQueryMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));
    expect(useQueryMock).toHaveBeenCalledWith({ title: 'Ojczyzna' }, expect.objectContaining({ retry: 1 }));
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
          startsAt: '2026-07-04T18:30:00.000Z',
          venue: { id: 'v2', name: 'Kinoteka', category: 'cinema', city: 'Warsaw', country: 'PL' },
        }),
        makeEvent({
          id: 'e3', venueId: 'v3', sourceUrl: 'https://iluzjon.example/e3',
          startsAt: '2026-07-05T14:00:00.000Z',
          venue: { id: 'v3', name: 'Iluzjon', category: 'cinema', city: 'Warsaw', country: 'PL' },
        }),
      ],
    });

    render(<ClosestScreenings event={event} />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', 'https://kinoteka.example/e2');
    expect(screen.getByText('Kinoteka')).toBeInTheDocument();
    expect(screen.getByText('Iluzjon')).toBeInTheDocument();
    // Kino Muranów only had the screening we clicked from, so it drops out.
    expect(screen.queryByText('Kino Muranów')).not.toBeInTheDocument();
  });

  // GOI-46: "place - time - time - time", one line per venue per day, rather
  // than one row per venue with the rest hidden behind "+2 more".
  it('lists every time a venue screens the film on a day, next to the venue', () => {
    const event = makeEvent();
    useQueryMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [
        event,
        makeEvent({
          id: 'k1', venueId: 'v2', sourceUrl: 'https://kinoteka.example/k1',
          startsAt: '2026-07-04T12:00:00.000Z',
          venue: { id: 'v2', name: 'Kinoteka', category: 'cinema', city: 'Warsaw', country: 'PL' },
        }),
        makeEvent({
          id: 'k2', venueId: 'v2', sourceUrl: 'https://kinoteka.example/k2',
          startsAt: '2026-07-04T16:00:00.000Z',
          venue: { id: 'v2', name: 'Kinoteka', category: 'cinema', city: 'Warsaw', country: 'PL' },
        }),
        makeEvent({
          id: 'k3', venueId: 'v2', sourceUrl: 'https://kinoteka.example/k3',
          startsAt: '2026-07-05T12:00:00.000Z',
          venue: { id: 'v2', name: 'Kinoteka', category: 'cinema', city: 'Warsaw', country: 'PL' },
        }),
      ],
    });

    render(<ClosestScreenings event={event} />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));

    // Two days, and the first one carries both of that day's Kinoteka times.
    const firstDay = dayBlock(/^4 Jul$/);
    const times = within(firstDay).getAllByRole('link');
    expect(times.map((t) => t.textContent)).toEqual(['14:00', '18:00']);
    expect(times[0]).toHaveAttribute('href', 'https://kinoteka.example/k1');

    const secondDay = dayBlock(/^5 Jul$/);
    expect(within(secondDay).getAllByRole('link').map((t) => t.textContent)).toEqual(['14:00']);
  });

  it('offers later showings at the same venue you clicked from', () => {
    const event = makeEvent(); // 20:00 Warsaw at Kino Muranów
    useQueryMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [
        event,
        makeEvent({ id: 'm2', sourceUrl: 'https://muranow.example/m2', startsAt: '2026-07-04T19:15:00.000Z' }),
      ],
    });

    render(<ClosestScreenings event={event} />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));

    expect(screen.getByText('Kino Muranów')).toBeInTheDocument();
    const [link] = screen.getAllByRole('link');
    expect(link).toHaveAttribute('href', 'https://muranow.example/m2');
    expect(link).toHaveTextContent('21:15');
  });

  // The want-to-go list has no date of its own on the row, so the panel there
  // must show the saved showing rather than hiding it as "the one you're on".
  it('keeps the event itself when asked to include it', () => {
    const event = makeEvent();
    useQueryMock.mockReturnValue({ data: [event], isLoading: false, isError: false });

    render(<ClosestScreenings event={event} includeSelf />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));

    const [link] = screen.getAllByRole('link');
    expect(link).toHaveAttribute('href', 'https://muranow.example/e1');
    expect(link).toHaveTextContent('20:00');
  });

  it('hides days beyond the first two behind "See more"', () => {
    const event = makeEvent();
    useQueryMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [
        makeEvent({ id: 'd1', startsAt: '2026-07-04T12:00:00.000Z' }),
        makeEvent({ id: 'd2', startsAt: '2026-07-05T12:00:00.000Z' }),
        makeEvent({ id: 'd3', startsAt: '2026-07-06T12:00:00.000Z' }),
      ],
    });

    render(<ClosestScreenings event={event} includeSelf />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));

    expect(screen.getByText('4 Jul')).toBeInTheDocument();
    expect(screen.getByText('5 Jul')).toBeInTheDocument();
    expect(screen.queryByText('6 Jul')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /see more/i }));
    expect(screen.getByText('6 Jul')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /see more/i })).not.toBeInTheDocument();
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

describe('groupByDay', () => {
  const now = new Date('2026-07-04T09:00:00.000Z'); // 11:00 Warsaw

  it('labels the current and next Warsaw day rather than dating them', () => {
    const days = groupByDay(
      [
        makeEvent({ id: 'a', startsAt: '2026-07-04T12:00:00.000Z' }),
        makeEvent({ id: 'b', startsAt: '2026-07-05T12:00:00.000Z' }),
        makeEvent({ id: 'c', startsAt: '2026-07-06T12:00:00.000Z' }),
      ],
      now,
    );
    expect(days.map((d) => d.label)).toEqual(['Today', 'Tomorrow', '6 Jul']);
  });

  // 22:30Z on 4 July is 00:30 on the 5th in Warsaw: the day a showing belongs
  // to is its *local* day, not the UTC one.
  it('files a late-night showing under its Warsaw day', () => {
    const days = groupByDay([makeEvent({ id: 'late', startsAt: '2026-07-04T22:30:00.000Z' })], now);
    expect(days).toHaveLength(1);
    expect(days[0]!.dayKey).toBe('2026-07-05');
    expect(days[0]!.label).toBe('Tomorrow');
  });

  it('keeps venues in first-showing order and times in time order', () => {
    const [day] = groupByDay(
      [
        makeEvent({
          id: 'k1', venueId: 'v2', startsAt: '2026-07-04T12:00:00.000Z',
          venue: { id: 'v2', name: 'Kinoteka', category: 'cinema', city: 'Warsaw', country: 'PL' },
        }),
        makeEvent({ id: 'm1', startsAt: '2026-07-04T13:00:00.000Z' }),
        makeEvent({
          id: 'k2', venueId: 'v2', startsAt: '2026-07-04T16:00:00.000Z',
          venue: { id: 'v2', name: 'Kinoteka', category: 'cinema', city: 'Warsaw', country: 'PL' },
        }),
      ],
      now,
    );
    expect(day!.venues.map((v) => v.venueName)).toEqual(['Kinoteka', 'Kino Muranów']);
    expect(day!.venues[0]!.showings.map((s) => s.id)).toEqual(['k1', 'k2']);
  });

  // A DST-safe "tomorrow": stepping the calendar day, not adding 24 hours.
  // Warsaw springs forward on 29 March 2026, so 24h from late on the 28th
  // lands on the 30th and would leave the 29th unlabelled.
  it('still labels tomorrow across a spring-forward night', () => {
    const days = groupByDay(
      [makeEvent({ id: 'dst', startsAt: '2026-03-29T18:00:00.000Z' })],
      new Date('2026-03-28T22:30:00.000Z'), // 23:30 Warsaw on the 28th
    );
    expect(days[0]!.label).toBe('Tomorrow');
  });
});

// GOI-26: the screenings panel is the *only* way a film reaches the want-to-go
// list — there is no free-text film field anywhere in the app.
describe('ClosestScreenings — Track film', () => {
  it('tracks the film under the title the venue uses', () => {
    loggedIn = true;
    render(<ClosestScreenings event={makeEvent()} />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));

    fireEvent.click(screen.getByRole('button', { name: /track film/i }));
    expect(addFilmMock).toHaveBeenCalledWith({ title: 'Ojczyzna' });
  });

  it('shows the film as already tracked instead of offering it twice', () => {
    loggedIn = true;
    filmsListMock.mockReturnValue({ data: [{ id: 'f1', title: 'ojczyzna', status: 'want' }] });

    render(<ClosestScreenings event={makeEvent()} />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));

    const button = screen.getByRole('button', { name: /on your want-to-go list/i });
    expect(button).toBeDisabled();
    expect(screen.queryByRole('button', { name: /track film/i })).not.toBeInTheDocument();
  });

  it('is hidden for logged-out visitors and for non-film events', () => {
    const { unmount } = render(<ClosestScreenings event={makeEvent()} />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));
    expect(screen.queryByRole('button', { name: /track film/i })).not.toBeInTheDocument();
    unmount();

    loggedIn = true;
    render(<ClosestScreenings event={makeEvent({ category: 'theatre' })} />);
    fireEvent.click(screen.getByRole('button', { name: /nearest dates/i }));
    expect(screen.queryByRole('button', { name: /track film/i })).not.toBeInTheDocument();
  });
});
