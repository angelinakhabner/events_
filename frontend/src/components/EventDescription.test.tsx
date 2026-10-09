import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Event } from '@afisz/shared';
import { EventDescription } from './EventDescription';

const base: Event = {
  id: 'e1', venueId: 'v1', title: 'Trojanki', description: null, longDescription: null,
  startsAt: '2026-10-02T17:00:00.000Z', endsAt: null, kind: 'timed', category: 'theatre',
  language: 'pl', director: null, cast: [], durationMinutes: null, priceMin: null, priceMax: null,
  sourceUrl: 'https://teatr.example/trojanki', sourceId: null, scrapedAt: '',
};

describe('EventDescription', () => {
  /** GOI-139: the short sentence to scan, the paragraph behind "Read more". */
  it('swaps in the long description on "Read more"', () => {
    render(
      <EventDescription
        event={{ ...base, description: 'A tragedy.', longDescription: 'After Troy falls, its women wait.' }}
      />,
    );
    expect(screen.getByText('A tragedy.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Czytaj dalej' }));
    expect(screen.getByText('After Troy falls, its women wait.')).toBeInTheDocument();
    expect(screen.queryByText('A tragedy.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Zwiń' }));
    expect(screen.getByText('A tragedy.')).toBeInTheDocument();
  });

  it('shows only the short one when there is nothing longer', () => {
    render(<EventDescription event={{ ...base, description: 'A tragedy.' }} />);
    expect(screen.getByText('A tragedy.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Czytaj dalej' })).not.toBeInTheDocument();
  });

  /** GOI-136: a bare theatre row points at the venue's page for the show. */
  it('points an undescribed theatre show at the venue’s page', () => {
    render(<EventDescription event={base} venueName="Teatr Powszechny" />);
    expect(screen.getByText(/brak opisu/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /na stronie teatr powszechny/i }))
      .toHaveAttribute('href', 'https://teatr.example/trojanki');
  });

  it('leaves an undescribed screening alone', () => {
    const { container } = render(<EventDescription event={{ ...base, category: 'cinema' }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
