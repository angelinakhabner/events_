import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DayBar } from './DayBar';

// "now" = Wed 2026-07-08 14:00 in Warsaw (CEST +02:00)
const now = new Date('2026-07-08T12:00:00.000Z');

describe('DayBar', () => {
  it('renders "Any day", "Today", "Tomorrow" and the five following days', () => {
    render(<DayBar selected={null} onChange={() => {}} now={now} />);
    expect(screen.getByRole('button', { name: 'Any day', pressed: true })).toBeInTheDocument();
    for (const label of ['Today', 'Tomorrow', 'Fri 10 Jul', 'Sat 11 Jul', 'Sun 12 Jul', 'Mon 13 Jul', 'Tue 14 Jul']) {
      expect(screen.getByRole('button', { name: label, pressed: false })).toBeInTheDocument();
    }
  });

  it('marks the currently-selected day as pressed', () => {
    render(<DayBar selected="2026-07-09" onChange={() => {}} now={now} />);
    expect(screen.getByRole('button', { name: 'Tomorrow', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Any day', pressed: false })).toBeInTheDocument();
  });

  it('calls onChange with the Warsaw day key on click', async () => {
    const onChange = vi.fn();
    render(<DayBar selected={null} onChange={onChange} now={now} />);
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(onChange).toHaveBeenCalledWith('2026-07-08');
    await userEvent.click(screen.getByRole('button', { name: 'Sat 11 Jul' }));
    expect(onChange).toHaveBeenCalledWith('2026-07-11');
  });

  it('calls onChange(null) when "Any day" is clicked', async () => {
    const onChange = vi.fn();
    render(<DayBar selected="2026-07-08" onChange={onChange} now={now} />);
    await userEvent.click(screen.getByRole('button', { name: 'Any day' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('uses the Warsaw calendar day, not UTC', async () => {
    // 22:30 UTC on Wed 8 Jul is already 00:30 Thu 9 Jul in Warsaw (CEST +02:00).
    const pastMidnight = new Date('2026-07-08T22:30:00.000Z');
    const onChange = vi.fn();
    render(<DayBar selected={null} onChange={onChange} now={pastMidnight} />);
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(onChange).toHaveBeenCalledWith('2026-07-09');
    expect(screen.getByRole('button', { name: 'Sat 11 Jul' })).toBeInTheDocument();
  });
});
