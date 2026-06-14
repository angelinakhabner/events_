import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EventCard } from './EventCard';
import type { Event, Venue } from '@goin/shared';

const venue: Venue = {
  id: 'v', name: 'Kino X', url: 'https://x', city: 'Warsaw', country: 'Poland',
  category: 'cinema', language: 'pl', timezone: 'Europe/Warsaw', createdAt: '',
};

const event: Event = {
  id: 'e1', venueId: 'v', title: 'Perfect Days', description: 'A film about a man and his routines.',
  startsAt: '2026-06-15T18:00:00.000Z', endsAt: null, durationMinutes: 124, director: null, cast: [],
  category: 'cinema', language: 'pl',
  priceMin: 28, priceMax: 32, sourceUrl: 'https://example.com/film', sourceId: null, scrapedAt: '',
};

describe('EventCard', () => {
  it('renders title, venue, category and description', () => {
    render(<EventCard event={event} venue={venue} />);
    expect(screen.getByRole('heading', { name: 'Perfect Days' })).toBeInTheDocument();
    expect(screen.getByText(/Kino X/)).toBeInTheDocument();
    expect(screen.getByText(/cinema/i)).toBeInTheDocument();
    expect(screen.getByText(/man and his routines/)).toBeInTheDocument();
  });

  it('the title is a link to the event source URL in a new tab', () => {
    render(<EventCard event={event} venue={venue} />);
    const link = screen.getByRole('link', { name: 'Perfect Days' });
    expect(link).toHaveAttribute('href', 'https://example.com/film');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('falls back to "Unknown venue" when no venue is supplied', () => {
    render(<EventCard event={event} venue={undefined} />);
    expect(screen.getByText('Unknown venue')).toBeInTheDocument();
  });

  it('prefers the inline event.venue over the prop fallback', () => {
    const inline = { id: 'v-uuid', name: 'Kino Inline', category: 'theatre' as const, city: 'Warsaw', country: 'PL' };
    render(<EventCard event={{ ...event, venue: inline }} venue={venue} />);
    expect(screen.getByText(/Kino Inline/)).toBeInTheDocument();
    expect(screen.queryByText(/Kino X/)).not.toBeInTheDocument();
    expect(screen.getByText(/theatre/i)).toBeInTheDocument();
  });

  it('opens an Add-to-calendar menu with Google + .ics options', async () => {
    render(<EventCard event={event} venue={venue} />);
    await userEvent.click(screen.getByRole('button', { name: /add to calendar/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    const google = screen.getByRole('menuitem', { name: /google calendar/i });
    expect(google).toHaveAttribute('href', expect.stringContaining('calendar.google.com/calendar/render'));
    expect(screen.getByRole('menuitem', { name: /apple/i })).toBeInTheDocument();
  });

  it('Share button calls navigator.share when present and shows "Shared"', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const originalShare = (navigator as { share?: unknown }).share;
    Object.defineProperty(navigator, 'share', { value: share, writable: true, configurable: true });
    try {
      render(<EventCard event={event} venue={venue} />);
      await userEvent.click(screen.getByRole('button', { name: /share/i }));
      expect(share).toHaveBeenCalled();
      expect(await screen.findByText(/shared/i)).toBeInTheDocument();
    } finally {
      if (originalShare === undefined) {
        delete (navigator as { share?: unknown }).share;
      } else {
        Object.defineProperty(navigator, 'share', { value: originalShare, configurable: true });
      }
    }
  });

  it('Share button falls back to clipboard and shows "Link copied" when share is missing', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    delete (navigator as { share?: unknown }).share;
    render(<EventCard event={event} venue={venue} />);
    await userEvent.click(screen.getByRole('button', { name: /share/i }));
    expect(writeText).toHaveBeenCalled();
    expect(await screen.findByText(/link copied/i)).toBeInTheDocument();
  });
});
