import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScreeningsStrip } from './ScreeningsStrip';
import type { Event } from '@afisz/shared';

const useQueryMock = vi.fn();
const filmsListMock = vi.fn();
const addFilmMock = vi.fn();
/** Whether the strip thinks there's a session — drives the "Track film" row. */
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
    // Warsaw wall clock, which is what the strip prints.
    startsAt: '2026-07-04T18:00:00.000Z', endsAt: null, durationMinutes: 110, director: null, cast: [],
    category: 'cinema', language: 'pl',
    priceMin: null, priceMax: null, sourceUrl: 'https://muranow.example/e1', sourceId: null, scrapedAt: '',
    ...overrides,
  };
}

beforeEach(() => {
  useQueryMock.mockReset();
  useQueryMock.mockReturnValue({ data: [], isLoading: false, isError: false });
  filmsListMock.mockReset();
  filmsListMock.mockReturnValue({ data: [] });
  addFilmMock.mockReset();
  loggedIn = false;
});

describe('ScreeningsStrip', () => {
  it('only queries once the button is clicked, using the title', () => {
    render(<ScreeningsStrip event={makeEvent()} />);
    expect(useQueryMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));
    expect(useQueryMock).toHaveBeenCalledWith({ title: 'Ojczyzna' }, expect.objectContaining({ retry: 1 }));
  });

  it('stamps each stub with its day, Warsaw time, and venue', () => {
    useQueryMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [
        makeEvent({
          id: 'k1', venueId: 'v2', sourceUrl: 'https://kinoteka.example/k1',
          startsAt: '2026-07-04T12:00:00.000Z',
          venue: { id: 'v2', name: 'Kinoteka', category: 'cinema', city: 'Warsaw', country: 'PL' },
        }),
      ],
    });

    render(<ScreeningsStrip event={makeEvent()} />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));

    const link = screen.getByRole('link', { name: '14:00' });
    expect(link).toHaveAttribute('href', 'https://kinoteka.example/k1');
    expect(screen.getByText('Kinoteka')).toBeInTheDocument();
  });

  // GOI-55: the home page used to render a day-by-day dropdown here. The stubs
  // are the point of the strip — the soonest one is inverted so it reads first.
  it('inverts the soonest stub only', () => {
    useQueryMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [
        makeEvent({ id: 'a', startsAt: '2026-07-04T12:00:00.000Z' }),
        makeEvent({ id: 'b', startsAt: '2026-07-04T16:00:00.000Z' }),
      ],
    });

    render(<ScreeningsStrip event={makeEvent()} />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));

    const [first, second] = screen.getAllByRole('link').map((a) => a.closest('div')!.parentElement!);
    expect(first).toHaveClass('bg-ink');
    expect(second).not.toHaveClass('bg-ink');
  });

  it('caps at three stubs and reveals the rest behind "+N"', () => {
    useQueryMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: ['a', 'b', 'c', 'd', 'e'].map((id, i) =>
        makeEvent({ id, startsAt: `2026-07-04T1${i}:00:00.000Z` }),
      ),
    });

    render(<ScreeningsStrip event={makeEvent()} />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));
    expect(screen.getAllByRole('link')).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: /show 2 more screenings/i }));
    expect(screen.getAllByRole('link')).toHaveLength(5);
  });

  // GOI-48: the calendar button belongs to one time at one venue, not to the
  // title — so there is one per stub, each naming the showing it books.
  it('puts an add-to-calendar button on every stub', () => {
    useQueryMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [
        makeEvent({
          id: 'k1', venueId: 'v2', startsAt: '2026-07-04T12:00:00.000Z',
          venue: { id: 'v2', name: 'Kinoteka', category: 'cinema', city: 'Warsaw', country: 'PL' },
        }),
      ],
    });

    render(<ScreeningsStrip event={makeEvent()} />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));

    expect(
      screen.getByRole('button', { name: 'Add Ojczyzna at Kinoteka, 4 Jul 14:00, to calendar' }),
    ).toBeInTheDocument();
  });

  it('non-cinema events get "Nearest dates" instead', () => {
    const event = makeEvent({ category: 'theatre', title: 'Dziady' });
    useQueryMock.mockReturnValue({ data: [], isLoading: false, isError: false });

    render(<ScreeningsStrip event={event} />);
    fireEvent.click(screen.getByRole('button', { name: /nearest dates/i }));

    expect(useQueryMock).toHaveBeenCalledWith({ title: 'Dziady' }, expect.anything());
    expect(screen.getByText(/no upcoming dates/i)).toBeInTheDocument();
  });

  it('shows a loading state while the query is in flight', () => {
    useQueryMock.mockReturnValue({ data: undefined, isLoading: true, isError: false });

    render(<ScreeningsStrip event={makeEvent()} />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));

    expect(screen.getByText(/looking for screenings/i)).toBeInTheDocument();
  });

  it('says so when the query fails', () => {
    useQueryMock.mockReturnValue({ data: undefined, isLoading: false, isError: true });

    render(<ScreeningsStrip event={makeEvent()} />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));

    expect(screen.getByText(/couldn’t load screenings/i)).toBeInTheDocument();
  });
});

// An event card prints the showing you are reading directly above the strip;
// the want-to-go list prints no time at all. Same strip, opposite needs.
describe('ScreeningsStrip — includeSelf', () => {
  it('drops the showing you are reading when asked to', () => {
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
      ],
    });

    render(<ScreeningsStrip event={event} includeSelf={false} />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://kinoteka.example/e2');
  });

  it('keeps a later showing at the same venue you are reading from', () => {
    const event = makeEvent(); // 20:00 Warsaw at Kino Muranów
    useQueryMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [
        event,
        makeEvent({ id: 'm2', sourceUrl: 'https://muranow.example/m2', startsAt: '2026-07-04T19:15:00.000Z' }),
      ],
    });

    render(<ScreeningsStrip event={event} includeSelf={false} />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));

    expect(screen.getByRole('link', { name: '21:15' })).toBeInTheDocument();
  });

  it('distinguishes "no other" from "none at all"', () => {
    const event = makeEvent();
    useQueryMock.mockReturnValue({ data: [event], isLoading: false, isError: false });

    const { unmount } = render(<ScreeningsStrip event={event} includeSelf={false} />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));
    expect(screen.getByText(/no other upcoming screenings/i)).toBeInTheDocument();
    unmount();

    useQueryMock.mockReturnValue({ data: [], isLoading: false, isError: false });
    render(<ScreeningsStrip event={event} />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));
    expect(screen.getByText(/^No upcoming screenings\.$/i)).toBeInTheDocument();
  });
});

// GOI-26: the screenings strip is the *only* way a film reaches the want-to-go
// list — there is no free-text film field anywhere in the app.
describe('ScreeningsStrip — Track film', () => {
  it('tracks the film under the title the venue uses', () => {
    loggedIn = true;
    render(<ScreeningsStrip event={makeEvent()} canTrack />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));

    fireEvent.click(screen.getByRole('button', { name: /track film/i }));
    expect(addFilmMock).toHaveBeenCalledWith({ title: 'Ojczyzna' });
  });

  // Nothing to screen is exactly when you most want to be told about the next
  // run, so the row has to outlive an empty result.
  it('offers tracking even when there are no screenings to show', () => {
    loggedIn = true;
    useQueryMock.mockReturnValue({ data: [], isLoading: false, isError: false });

    render(<ScreeningsStrip event={makeEvent()} canTrack />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));

    expect(screen.getByRole('button', { name: /track film/i })).toBeInTheDocument();
  });

  it('shows the film as already tracked instead of offering it twice', () => {
    loggedIn = true;
    filmsListMock.mockReturnValue({ data: [{ id: 'f1', title: 'ojczyzna', status: 'want' }] });

    render(<ScreeningsStrip event={makeEvent()} canTrack />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));

    const button = screen.getByRole('button', { name: /on your want-to-go list/i });
    expect(button).toBeDisabled();
    expect(screen.queryByRole('button', { name: /track film/i })).not.toBeInTheDocument();
  });

  it('is hidden for logged-out visitors, for non-films, and where nothing can be tracked', () => {
    const { unmount } = render(<ScreeningsStrip event={makeEvent()} canTrack />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));
    expect(screen.queryByRole('button', { name: /track film/i })).not.toBeInTheDocument();
    unmount();

    loggedIn = true;
    const theatre = render(<ScreeningsStrip event={makeEvent({ category: 'theatre' })} canTrack />);
    fireEvent.click(screen.getByRole('button', { name: /nearest dates/i }));
    expect(screen.queryByRole('button', { name: /track film/i })).not.toBeInTheDocument();
    theatre.unmount();

    // The want-to-go list leaves `canTrack` off — the film is already on it.
    render(<ScreeningsStrip event={makeEvent()} />);
    fireEvent.click(screen.getByRole('button', { name: /nearest screenings/i }));
    expect(screen.queryByRole('button', { name: /track film/i })).not.toBeInTheDocument();
  });
});
