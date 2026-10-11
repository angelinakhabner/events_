/**
 * GOI-62: the "Want to go" button moved when you pressed it, and stopped
 * lining up with the buttons beside it — on a phone, where the action row is
 * already wrapping.
 *
 * The cause is a layout one, so the test is about layout: the button's two
 * labels differ by five characters, and it is the *first* item in a
 * `flex flex-wrap` row. Toggling it re-measured everything after it. What has
 * to hold is that the button occupies the same width in both states, which is
 * checked here through the markup that reserves it rather than through a
 * computed width jsdom does not compute.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Event } from '@afisz/shared';

let savedIds: string[] = [];
const add = vi.fn();
const remove = vi.fn();

vi.mock('../lib/auth', () => ({ isLoggedIn: () => true }));
vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      my: { wantToGo: { ids: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } } },
    }),
    my: {
      wantToGo: {
        ids: { useQuery: () => ({ data: savedIds, isLoading: false, error: null }) },
        add: { useMutation: () => ({ mutate: add, isPending: false }) },
        remove: { useMutation: () => ({ mutate: remove, isPending: false }) },
      },
    },
    events: { screenings: { useQuery: () => ({ data: [], isLoading: false, error: null }) } },
  },
}));

import { EventActions } from './EventActions';

const event: Event = {
  id: 'e1', venueId: 'v',
  venue: { id: 'v', name: 'Kino X', category: 'cinema', city: 'Warsaw', country: 'PL' },
  title: 'Perfect Days', description: 'A film.',
  startsAt: '2026-06-01T18:00:00.000Z', endsAt: null, durationMinutes: 124, director: null, cast: [],
  category: 'cinema', language: 'pl',
  priceMin: 28, priceMax: 32, sourceUrl: 'https://example.com/e1', sourceId: null, scrapedAt: '',
} as Event;

/** The button, whichever of its two labels it is currently showing. */
function wantToGoButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /want to go|going/i }) as HTMLButtonElement;
}

beforeEach(() => {
  savedIds = [];
  add.mockReset();
  remove.mockReset();
});

describe('Want to go — a button that stays put', () => {
  it('reserves the wider label\'s width while showing the narrower one', () => {
    savedIds = ['e1'];
    render(<EventActions event={event} />);
    const button = wantToGoButton();

    // What the reader sees.
    expect(button).toHaveTextContent('♥ Going');
    // …over a sizer holding the width of the label it is *not* showing, so
    // the row after it does not re-wrap.
    const sizer = button.querySelector('[aria-hidden="true"]');
    expect(sizer).toHaveTextContent('♡ Want to go');
    expect(sizer).toHaveClass('invisible');
  });

  it('reserves the same width in the unsaved state', () => {
    render(<EventActions event={event} />);
    const sizer = wantToGoButton().querySelector('[aria-hidden="true"]');
    expect(sizer).toHaveTextContent('♡ Want to go');
  });

  /**
   * The sizer is deliberately in normal flow and the live label on top of it,
   * not the other way round. `.act-row` aligns its items on the baseline, and
   * a button whose only content is absolutely positioned contributes none —
   * which is the other half of "not aligned with other buttons".
   */
  it('keeps a laid-out label so the row still has a baseline to align on', () => {
    render(<EventActions event={event} />);
    const button = wantToGoButton();
    const sizer = button.querySelector('[aria-hidden="true"]')!;
    expect(sizer.className).not.toContain('absolute');
    expect(button.querySelector('.absolute')).toHaveTextContent('♡ Want to go');
  });

  /** The sizer must never reach the accessible name — it would be read out
   *  as a second, contradictory label. */
  it('says one thing to a screen reader, not two', () => {
    savedIds = ['e1'];
    render(<EventActions event={event} />);
    expect(screen.getByRole('button', { name: '♥ Going' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /want to go/i })).not.toBeInTheDocument();
  });

  it('still toggles', () => {
    render(<EventActions event={event} />);
    fireEvent.click(wantToGoButton());
    expect(add).toHaveBeenCalledWith({ eventId: 'e1' });

    savedIds = ['e1'];
    render(<EventActions event={event} />);
    fireEvent.click(screen.getAllByRole('button', { name: '♥ Going' })[0]!);
    expect(remove).toHaveBeenCalledWith({ eventId: 'e1' });
  });

  it('sets aria-pressed so the state is not only a glyph', () => {
    render(<EventActions event={event} />);
    expect(wantToGoButton()).toHaveAttribute('aria-pressed', 'false');
  });
});
