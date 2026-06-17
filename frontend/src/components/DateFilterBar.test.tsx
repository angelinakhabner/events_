import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DateFilterBar } from './DateFilterBar';
import type { DateRange } from '../lib/date-filter';

describe('DateFilterBar', () => {
  it('selects Today and Next 3 days', () => {
    const onChange = vi.fn();
    render(<DateFilterBar value={{ kind: 'all' }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'today' });
    fireEvent.click(screen.getByRole('button', { name: 'Next 3 days' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'next3' });
  });

  it('toggles the active quick-filter back to "all"', () => {
    const onChange = vi.fn();
    render(<DateFilterBar value={{ kind: 'today' }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'all' });
  });

  it('reveals a date input and emits a date range on pick', () => {
    const onChange = vi.fn();
    render(<DateFilterBar value={{ kind: 'all' }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose date' }));
    const input = screen.getByLabelText('Choose date');
    fireEvent.change(input, { target: { value: '2026-06-20' } });
    expect(onChange).toHaveBeenCalledWith({ kind: 'date', date: '2026-06-20' });
  });

  it('shows the chosen date on the button when active', () => {
    const value: DateRange = { kind: 'date', date: '2026-06-20' };
    render(<DateFilterBar value={value} onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Choose date' })).not.toBeInTheDocument();
    expect(screen.getByText(/20 Jun/)).toBeInTheDocument();
  });
});
