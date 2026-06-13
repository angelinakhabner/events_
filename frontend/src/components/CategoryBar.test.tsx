import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CategoryBar } from './CategoryBar';

describe('CategoryBar', () => {
  it('renders all six options with "All" pressed when nothing is selected', () => {
    render(<CategoryBar selected={null} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'All', pressed: true })).toBeInTheDocument();
    for (const label of ['Cinema', 'Theatre', 'Comedy', 'Music', 'Museums']) {
      expect(screen.getByRole('button', { name: label, pressed: false })).toBeInTheDocument();
    }
  });

  it('marks the currently-selected category as pressed', () => {
    render(<CategoryBar selected="exhibition" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Museums', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All', pressed: false })).toBeInTheDocument();
  });

  it('calls onChange with the underlying enum value on click', async () => {
    const onChange = vi.fn();
    render(<CategoryBar selected={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Museums' }));
    // UI label is "Museums" but value stays "exhibition" to match the schema.
    expect(onChange).toHaveBeenCalledWith('exhibition');
  });

  it('calls onChange(null) when "All" is clicked', async () => {
    const onChange = vi.fn();
    render(<CategoryBar selected="cinema" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
