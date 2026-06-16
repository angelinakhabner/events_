import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EventActions } from './EventActions';
import type { Event } from '@goin/shared';

const event: Event = {
  id: 'e1', venueId: 'v',
  venue: { id: 'v', name: 'Kino X', category: 'cinema', city: 'Warsaw', country: 'PL' },
  title: 'Perfect Days', description: 'A film.',
  startsAt: '2026-06-01T18:00:00.000Z', endsAt: null, durationMinutes: 124, director: null, cast: [],
  category: 'cinema', language: 'pl',
  priceMin: 28, priceMax: 32, sourceUrl: 'https://example.com/e1', sourceId: null, scrapedAt: '',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EventActions', () => {
  it('reveals Google Calendar and .ics options from the "Add to calendar" menu', () => {
    render(<EventActions event={event} />);
    fireEvent.click(screen.getByRole('button', { name: /add to calendar/i }));

    const gcal = screen.getByRole('menuitem', { name: /google calendar/i });
    expect(gcal).toHaveAttribute('href', expect.stringContaining('calendar.google.com'));
    expect(gcal).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('menuitem', { name: /\.ics/i })).toBeInTheDocument();
  });

  it('shares via the Web Share API when available', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share });
    render(<EventActions event={event} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    await vi.waitFor(() => expect(share).toHaveBeenCalledOnce());
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Perfect Days', url: 'https://example.com/e1' }),
    );
  });

  it('falls back to copying the link when Web Share is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<EventActions event={event} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(await screen.findByText(/link copied/i)).toBeInTheDocument();
  });
});
