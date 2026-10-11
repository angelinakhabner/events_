import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SharedListPage } from './SharedList';
import type { Event, Film, WantToGoEntry } from '@afisz/shared';

const listMock = vi.fn();
const screeningsMock = vi.fn();

vi.mock('../lib/auth', () => ({ isLoggedIn: () => false }));
vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ my: { films: { list: { invalidate: () => Promise.resolve() } } } }),
    sharedList: { get: { useQuery: (...a: unknown[]) => listMock(...a) } },
    events: { screenings: { useQuery: (...a: unknown[]) => screeningsMock(...a) } },
    my: { films: { list: { useQuery: () => ({ data: [] }) } } },
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

function renderAt(token: string) {
  return render(
    <MemoryRouter initialEntries={[`/list/${token}`]}>
      <Routes>
        <Route path="/list/:token" element={<SharedListPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listMock.mockReset().mockReturnValue({ data: undefined, isLoading: true, error: null });
  screeningsMock.mockReset().mockReturnValue({ data: [], isLoading: false, isError: false });
});

// GOI-47: someone else's list, opened from a share link. No session.
describe('SharedListPage', () => {
  it('queries by the token in the URL', () => {
    renderAt('tok123');
    expect(listMock).toHaveBeenCalledWith({ token: 'tok123' }, expect.objectContaining({ retry: false }));
  });

  it('lists saved events and tracked films together, newest first', () => {
    listMock.mockReturnValue({
      data: {
        entries: [makeEntry({ savedAt: '2026-07-01T10:00:00.000Z' })],
        films: [makeFilm({ createdAt: '2026-07-03T10:00:00.000Z' })],
      },
      isLoading: false,
      error: null,
    });

    renderAt('tok123');

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Vertigo');
    expect(items[1]).toHaveTextContent('Ojczyzna');
  });

  it('offers the screenings panel, so the link is useful and not just a list of names', () => {
    listMock.mockReturnValue({
      data: { entries: [makeEntry()], films: [] },
      isLoading: false,
      error: null,
    });

    renderAt('tok123');
    expect(screen.getByRole('button', { name: /nearest screenings/i })).toBeInTheDocument();
  });

  it('carries no owner actions — a shared list is read-only', () => {
    listMock.mockReturnValue({
      data: { entries: [makeEntry()], films: [makeFilm()] },
      isLoading: false,
      error: null,
    });

    renderAt('tok123');
    expect(screen.queryByRole('button', { name: /seen it/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });

  it('never names the owner', () => {
    listMock.mockReturnValue({
      data: { entries: [makeEntry()], films: [] },
      isLoading: false,
      error: null,
    });

    const { container } = renderAt('tok123');
    expect(container.textContent).not.toMatch(/@/);
  });

  it('says the link is dead rather than showing an empty list', () => {
    listMock.mockReturnValue({ data: undefined, isLoading: false, error: { message: 'NOT_FOUND' } });

    renderAt('revoked');
    expect(screen.getByRole('alert')).toHaveTextContent(/isn’t shared any more|link is wrong/i);
    expect(screen.getByRole('link', { name: /browse what/i })).toBeInTheDocument();
  });

  it('distinguishes an empty shared list from a broken link', () => {
    listMock.mockReturnValue({ data: { entries: [], films: [] }, isLoading: false, error: null });

    renderAt('tok123');
    expect(screen.getByText(/this list is empty/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
