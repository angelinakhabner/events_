import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewFolderModal } from './NewFolderModal';
import type { Venue } from '@goin/shared';

const venues: Venue[] = [
  { id: 'v1', name: 'Kino Muranów', url: 'https://m', city: 'Warsaw', country: 'Poland', category: 'cinema', language: 'pl', timezone: 'Europe/Warsaw', createdAt: '' },
  { id: 'v2', name: 'Teatr Powszechny', url: 'https://t', city: 'Warsaw', country: 'Poland', category: 'theatre', language: 'pl', timezone: 'Europe/Warsaw', createdAt: '' },
];

describe('NewFolderModal', () => {
  it('blocks submission with an empty name and shows a validation message', async () => {
    const onSubmit = vi.fn();
    render(<NewFolderModal venues={venues} onCancel={() => {}} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: /create folder/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/give your folder a name/i);
  });

  it('submits with name, selected venues, and selected categories', async () => {
    const onSubmit = vi.fn();
    render(<NewFolderModal venues={venues} onCancel={() => {}} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText(/name/i), 'Weeknight cinema');
    await userEvent.click(screen.getByLabelText(/Kino Muranów/));
    await userEvent.click(screen.getByRole('button', { name: 'cinema' }));
    await userEvent.click(screen.getByRole('button', { name: /create folder/i }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Weeknight cinema',
      venueIds: ['v1'],
      filters: { categories: ['cinema'] },
    });
  });

  it('renders a server error when serverError prop is provided', () => {
    render(
      <NewFolderModal
        venues={venues}
        onCancel={() => {}}
        onSubmit={() => {}}
        serverError="UNAUTHORIZED"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn.+create folder.*UNAUTHORIZED/i);
  });

  it('calls onCancel when the cancel button is pressed', async () => {
    const onCancel = vi.fn();
    render(<NewFolderModal venues={venues} onCancel={onCancel} onSubmit={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
