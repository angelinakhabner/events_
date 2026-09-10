/**
 * GOI-127: on a phone the page opens on the logo and the festival, not on the
 * masthead.
 *
 * jsdom has no CSS, so this cannot measure what is on screen — what it can do
 * is hold the two decisions the change rests on, which is where a later edit
 * would quietly undo it: the band is not drawn below `md`, and the heading it
 * carried does not disappear with it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Venue } from '@afisz/shared';

vi.mock('../lib/auth', () => ({ isLoggedIn: () => false }));
vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ my: { wantToGo: { ids: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } } } }),
    events: {
      listDefault: { useQuery: () => ({ data: [], isLoading: false, error: null }) },
      screenings: { useQuery: () => ({ data: [], isLoading: false, error: null }) },
      filterOptions: { useQuery: () => ({ data: { venues: [] }, isLoading: false, error: null }) },
    },
    venues: { list: { useQuery: () => ({ data: venues, isLoading: false, error: null }) } },
    festivals: { list: { useQuery: () => ({ data: [], isLoading: false, error: null }) } },
  },
}));

import { HomePage } from './Home';

const venues: Venue[] = [];

describe('the masthead is desktop-only (GOI-127)', () => {
  it('does not draw the band below md', () => {
    render(<HomePage />);
    const band = screen.getByText('DZIEJE').closest('div.bg-ink');
    expect(band).not.toBeNull();
    // `hidden` with no breakpoint is the mobile state; `md:block` brings it
    // back. A band that only shrank would still be spending the top of the
    // screen on it, which is the thing being fixed.
    expect(band!.className).toContain('hidden');
    expect(band!.className).toContain('md:block');
  });

  it('takes the intro paragraph with it rather than leaving it behind', () => {
    render(<HomePage />);
    const blurb = screen.getByText(/one listing, refreshed every few minutes/i);
    expect(blurb.closest('div.bg-ink')).not.toBeNull();
  });

  it('still gives the page a heading on a phone', () => {
    render(<HomePage />);
    // The wordmark in the header is a link, not a heading, so this is the home
    // page's only h1 — dropping the element instead of hiding it would leave a
    // screen reader and a crawler with none at phone width.
    const mobile = screen
      .getAllByRole('heading', { level: 1 })
      .find((h) => h.className.includes('sr-only'));
    expect(mobile, 'no screen-reader heading for the hidden masthead').toBeDefined();
    expect(mobile!.textContent).toMatch(/co się dzieje/i);
    // And it is not a second heading on desktop, where the band draws its own.
    expect(mobile!.className).toContain('md:hidden');
  });
});
