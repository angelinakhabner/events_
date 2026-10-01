import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimeBar } from './TimeBar';

describe('TimeBar', () => {
  it('renders "Any time" plus the preset cutoffs', () => {
    render(<TimeBar selected={null} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Każda pora', pressed: true })).toBeInTheDocument();
    for (const label of ['Po 12:00', 'Po 16:00', 'Po 18:00', 'Po 20:00']) {
      expect(screen.getByRole('button', { name: label, pressed: false })).toBeInTheDocument();
    }
  });

  it('marks the selected preset as pressed', () => {
    render(<TimeBar selected={18} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Po 18:00', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Każda pora', pressed: false })).toBeInTheDocument();
  });

  it('reports the chosen hour on click, and null for "Any time"', async () => {
    const onChange = vi.fn();
    render(<TimeBar selected={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Po 16:00' }));
    expect(onChange).toHaveBeenCalledWith(16);

    onChange.mockClear();
    render(<TimeBar selected={16} onChange={onChange} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Każda pora' })[1]!);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('offers every hour in the select for cutoffs the presets do not cover', async () => {
    const onChange = vi.fn();
    render(<TimeBar selected={null} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText('Godzina rozpoczęcia'), '9');
    expect(onChange).toHaveBeenCalledWith(9);
  });

  it('shows a custom hour in the select, and leaves it blank for a preset', () => {
    const { unmount } = render(<TimeBar selected={9} onChange={() => {}} />);
    expect(screen.getByLabelText<HTMLSelectElement>('Godzina rozpoczęcia').value).toBe('9');
    // No preset chip should look active for a custom hour.
    expect(screen.getByRole('button', { name: 'Każda pora', pressed: false })).toBeInTheDocument();
    unmount();

    render(<TimeBar selected={18} onChange={() => {}} />);
    expect(screen.getByLabelText<HTMLSelectElement>('Godzina rozpoczęcia').value).toBe('');
  });
});
