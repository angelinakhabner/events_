import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventCard } from './EventCard';
import type { Event, Venue } from '@goin/shared';

const venue: Venue = {
  id: 'v', name: 'Kino X', url: 'https://x', city: 'Warsaw', country: 'Poland',
  category: 'cinema', language: 'pl', createdAt: '',
};

const event: Event = {
  id: 'e1', venueId: 'v', title: 'Perfect Days', description: 'A film about a man and his routines.',
  startsAt: '2026-06-01T18:00:00.000Z', endsAt: null, durationMinutes: 124, director: null, cast: [],
  genre: null, priceMin: 28, priceMax: 32, link: 'https://example.com', scrapedAt: '',
};

describe('EventCard', () => {
  it('renders title, venue, category and description', () => {
    render(<EventCard event={event} venue={venue} />);
    expect(screen.getByRole('heading', { name: 'Perfect Days' })).toBeInTheDocument();
    expect(screen.getByText(/Kino X/)).toBeInTheDocument();
    expect(screen.getByText(/cinema/i)).toBeInTheDocument();
    expect(screen.getByText(/man and his routines/)).toBeInTheDocument();
  });

  it('links to the venue source URL in a new tab', () => {
    render(<EventCard event={event} venue={venue} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('falls back to "Unknown venue" when venue is missing', () => {
    render(<EventCard event={event} venue={undefined} />);
    expect(screen.getByText('Unknown venue')).toBeInTheDocument();
  });
});
