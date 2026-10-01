import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CategoryBar } from './CategoryBar';

describe('CategoryBar', () => {
  it('renders all six options with "All" pressed when nothing is selected', () => {
    render(<CategoryBar selected={null} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Wszystko', pressed: true })).toBeInTheDocument();
    for (const label of ['Kino', 'Teatr', 'Stand-up', 'Muzyka', 'Muzea']) {
      expect(screen.getByRole('button', { name: label, pressed: false })).toBeInTheDocument();
    }
  });

  it('marks the currently-selected category as pressed', () => {
    render(<CategoryBar selected="exhibition" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Muzea', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wszystko', pressed: false })).toBeInTheDocument();
  });

  it('calls onChange with the underlying enum value on click', async () => {
    const onChange = vi.fn();
    render(<CategoryBar selected={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Muzea' }));
    // UI label is "Museums" but value stays "exhibition" to match the schema.
    expect(onChange).toHaveBeenCalledWith('exhibition');
  });

  it('calls onChange(null) when "All" is clicked', async () => {
    const onChange = vi.fn();
    render(<CategoryBar selected="cinema" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Wszystko' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  // GOI-50: the top menu says "selected" one way — accent red — across type,
  // day and time. The chip used to fill with ink while day and time went red.
  it('fills the selected chip with accent red, not ink', () => {
    render(<CategoryBar selected="exhibition" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Muzea' }).className).toContain('bg-accent');
    expect(screen.getByRole('button', { name: 'Muzea' }).className).not.toContain('bg-ink');
    expect(screen.getByRole('button', { name: 'Kino' }).className).toContain('bg-transparent');
  });

  // The palette is two colours, so a coloured swatch on a filled chip can
  // vanish into it: the museum trapezoid is accent, and so is the live chip.
  it('inverts the selected chip\'s swatch so it stays visible on the fill', () => {
    const { container } = render(<CategoryBar selected="exhibition" onChange={() => {}} />);
    const swatch = (c: string) => container.querySelector<HTMLElement>(`[data-category="${c}"]`)!;

    expect(swatch('exhibition').style.background).toBe('rgb(255, 255, 255)');
    // An unselected chip keeps the palette colours.
    expect(swatch('theatre').style.background).toBe('rgb(198, 40, 40)');
  });
});
