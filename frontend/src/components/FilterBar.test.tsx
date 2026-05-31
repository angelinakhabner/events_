import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { EventFilters } from '@goin/shared';
import { FilterBar } from './FilterBar';

function Harness({ onChange }: { onChange: (f: EventFilters) => void }) {
  const [filters, setFilters] = useState<EventFilters>({});
  return (
    <FilterBar
      filters={filters}
      onChange={(f) => { setFilters(f); onChange(f); }}
    />
  );
}

describe('FilterBar', () => {
  it('toggles a category on click and reports aria-pressed state', async () => {
    const spy = vi.fn();
    render(<Harness onChange={spy} />);
    const cinema = screen.getByRole('button', { name: 'cinema', pressed: false });
    await userEvent.click(cinema);
    expect(spy).toHaveBeenLastCalledWith({ categories: ['cinema'] });
    expect(screen.getByRole('button', { name: 'cinema', pressed: true })).toBeInTheDocument();
  });

  it('clears the category list back to undefined when last item is toggled off', async () => {
    const spy = vi.fn();
    render(<Harness onChange={spy} />);
    const cinema = screen.getByRole('button', { name: 'cinema' });
    await userEvent.click(cinema);
    await userEvent.click(cinema);
    expect(spy).toHaveBeenLastCalledWith({ categories: undefined });
  });

  it('updates startHour from the select', async () => {
    const spy = vi.fn();
    render(<Harness onChange={spy} />);
    await userEvent.selectOptions(screen.getByLabelText('Start hour'), '18');
    expect(spy).toHaveBeenLastCalledWith({ startHour: 18 });
  });
});
