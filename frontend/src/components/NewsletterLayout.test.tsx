import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NewsletterGrouping } from '@afisz/shared';
import { moveVenue, NewsletterLayout, orderedVenues } from './NewsletterLayout';

const A = { id: 'a', name: 'Kino Muranów' };
const B = { id: 'b', name: 'Kinoteka' };
const C = { id: 'c', name: 'Teatr Powszechny' };

describe('venue order (GOI-140)', () => {
  it('puts placed venues first, as placed, and the rest in form order', () => {
    expect(orderedVenues([A, B, C], ['c', 'a']).map((v) => v.id)).toEqual(['c', 'a', 'b']);
  });

  it('moves a venue one step and writes the shown order out in full', () => {
    expect(moveVenue([A, B, C], [], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveVenue([A, B, C], [], 'a', -1)).toEqual([]);
  });

  it('keeps the place of a venue that is not shown right now', () => {
    expect(moveVenue([A, B], ['c', 'b', 'a'], 'a', -1)).toEqual(['a', 'b', 'c']);
  });
});

function Harness() {
  const [groupBy, setGroupBy] = useState<NewsletterGrouping>('event');
  const [order, setOrder] = useState<string[]>([]);
  return (
    <NewsletterLayout groupBy={groupBy} onGroupBy={setGroupBy} venues={[A, B, C]} order={order} onOrder={setOrder} />
  );
}

describe('NewsletterLayout', () => {
  it('switches between grouping by event and by venue', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const byVenue = screen.getByRole('radio', { name: 'Po miejscu' });
    expect(screen.getByRole('radio', { name: 'Po wydarzeniu' })).toHaveAttribute('aria-checked', 'true');
    await user.click(byVenue);
    expect(byVenue).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/osobny blok dla każdego miejsca/)).toBeInTheDocument();
  });

  it('reorders the venues with the arrows', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Przesuń Teatr Powszechny wyżej' }));
    const list = screen.getByRole('list', { name: 'Kolejność miejsc' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('Kino Muranów'),
      expect.stringContaining('Teatr Powszechny'),
      expect.stringContaining('Kinoteka'),
    ]);
    expect(screen.getByRole('button', { name: 'Przesuń Kino Muranów wyżej' })).toBeDisabled();
  });
});
