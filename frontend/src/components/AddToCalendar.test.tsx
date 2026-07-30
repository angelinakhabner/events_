import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddToCalendar, addToCalendarLabel } from './AddToCalendar';
import type { Event } from '@goin/shared';

const downloadIcsMock = vi.fn();
vi.mock('../lib/calendar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/calendar')>();
  return { ...actual, downloadIcs: (...args: unknown[]) => downloadIcsMock(...args) };
});

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'e1', venueId: 'v1',
    venue: { id: 'v1', name: 'Kinoteka', category: 'cinema', city: 'Warsaw', country: 'PL' },
    title: 'Ojczyzna', description: null,
    // 12:00Z is 14:00 in Warsaw in July.
    startsAt: '2026-07-04T12:00:00.000Z', endsAt: null, durationMinutes: 110, director: null, cast: [],
    category: 'cinema', language: 'pl',
    priceMin: null, priceMax: null, sourceUrl: 'https://kinoteka.example/e1', sourceId: null, scrapedAt: '',
    ...overrides,
  };
}

beforeEach(() => downloadIcsMock.mockReset());

describe('AddToCalendar', () => {
  it('offers Google and .ics behind the labelled button', () => {
    render(<AddToCalendar event={makeEvent()} />);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add to calendar' }));
    expect(screen.getByRole('menuitem', { name: /google calendar/i })).toHaveAttribute(
      'href',
      expect.stringContaining('calendar.google.com'),
    );

    fireEvent.click(screen.getByRole('menuitem', { name: /apple \/ outlook/i }));
    expect(downloadIcsMock).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on Escape', () => {
    render(<AddToCalendar event={makeEvent()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add to calendar' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  // GOI-48: in the screenings panel the button sits beside a bare time, so the
  // word moves into the accessible name — which has to say *which* showing it
  // books, since a row carries several side by side.
  describe('icon variant', () => {
    it('names the venue and time it will book', () => {
      render(<AddToCalendar event={makeEvent()} variant="icon" />);

      const button = screen.getByRole('button', {
        name: 'Add Ojczyzna at Kinoteka, 4 Jul 14:00, to calendar',
      });
      expect(button).toBeInTheDocument();
      // The glyph itself must not reach the accessible name.
      expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    });

    it('opens the same menu as the labelled button', () => {
      render(<AddToCalendar event={makeEvent()} variant="icon" />);
      fireEvent.click(screen.getByRole('button', { name: /to calendar$/ }));

      expect(screen.getByRole('menuitem', { name: /google calendar/i })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: /apple \/ outlook/i })).toBeInTheDocument();
    });

    it('drops the venue from the name when the screening has none', () => {
      expect(addToCalendarLabel(makeEvent({ venue: undefined }))).toBe(
        'Add Ojczyzna, 4 Jul 14:00, to calendar',
      );
    });
  });
});
