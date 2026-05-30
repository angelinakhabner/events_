import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VenueList } from './VenueList';
import type { Venue } from '@goin/shared';

const venue: Venue = {
  id: 'x', name: 'Kino X', url: 'https://x', city: 'Warsaw', country: 'Poland',
  category: 'cinema', language: 'pl', createdAt: '',
};

describe('VenueList', () => {
  it('renders an empty message when no venues', () => {
    render(<VenueList venues={[]} />);
    expect(screen.getByText(/no venues/i)).toBeInTheDocument();
  });

  it('renders venue name, city, country and category', () => {
    render(<VenueList venues={[venue]} />);
    expect(screen.getByText('Kino X')).toBeInTheDocument();
    expect(screen.getByText(/Warsaw, Poland/)).toBeInTheDocument();
    expect(screen.getByText(/cinema/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://x' })).toHaveAttribute('href', 'https://x');
  });
});
