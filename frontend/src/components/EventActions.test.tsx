import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EventActions } from './EventActions';
import type { Event, Venue } from '@goin/shared';

const venue: Venue = {
  id: 'v', name: 'Kino X', url: 'https://x', city: 'Warsaw', country: 'Poland',
  category: 'cinema', language: 'pl', timezone: 'Europe/Warsaw', createdAt: '',
};

const event: Event = {
  id: 'e1', venueId: 'v', title: 'Perfect Days', description: 'A film.',
  startsAt: '2026-06-01T18:00:00.000Z', endsAt: null, durationMinutes: 124, director: null, cast: [],
  category: 'cinema', language: 'pl',
  priceMin: 28, priceMax: 32, sourceUrl: 'https://example.com/e1', sourceId: null, scrapedAt: '',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EventActions', () => {
  it('links to Google Calendar with a pre-filled template', () => {
    render(<EventActions event={event} venue={venue} />);
    const link = screen.getByRole('link', { name: /google calendar/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('calendar.google.com'));
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('offers an iCal download button', () => {
    render(<EventActions event={event} venue={venue} />);
    expect(screen.getByRole('button', { name: /ical/i })).toBeInTheDocument();
  });

  it('uses the Web Share API when available', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share });
    render(<EventActions event={event} venue={venue} />);
    fireEvent.click(screen.getByRole('button', { name: /invite a friend/i }));
    await waitFor(() => expect(share).toHaveBeenCalledOnce());
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('I invite you to share "Perfect Days"'),
        url: 'https://example.com/e1',
      }),
    );
  });

  it('copies the invitation to the clipboard when Web Share is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<EventActions event={event} venue={venue} />);
    fireEvent.click(screen.getByRole('button', { name: /invite a friend/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(await screen.findByText(/invitation copied/i)).toBeInTheDocument();
  });
});
