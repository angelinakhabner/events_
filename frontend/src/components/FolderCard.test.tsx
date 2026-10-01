import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FolderCard } from './FolderCard';
import type { Folder, Venue } from '@afisz/shared';

const venues: Venue[] = [
  { id: 'v1', name: 'Kino X', url: 'https://x', city: 'Warsaw', country: 'Poland', category: 'cinema', language: 'pl', timezone: 'Europe/Warsaw', createdAt: '' },
];

function folder(overrides: Partial<Folder> = {}): Folder {
  return {
    id: 'f1', userId: null, name: 'My folder', venueIds: ['v1'],
    filters: { categories: ['cinema'], startHour: 18 }, createdAt: '',
    ...overrides,
  };
}

describe('FolderCard', () => {
  it('renders name and filter summary', () => {
    render(
      <FolderCard
        folder={folder()} venues={venues} expanded={false}
        onToggle={() => {}} onRename={() => {}} onDelete={() => {}}
      />,
    );
    expect(screen.getByText('My folder')).toBeInTheDocument();
    expect(screen.getByText(/1 miejsce · Kino · Po 18:00/)).toBeInTheDocument();
  });

  it('calls onRename when the name is edited and Enter is pressed', async () => {
    const onRename = vi.fn();
    render(
      <FolderCard
        folder={folder()} venues={venues} expanded={false}
        onToggle={() => {}} onRename={onRename} onDelete={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /zmień nazwę folderu/i }));
    const input = screen.getByLabelText('Nazwa folderu');
    await userEvent.clear(input);
    await userEvent.type(input, 'Renamed{Enter}');
    expect(onRename).toHaveBeenCalledWith('Renamed');
  });

  it('requires a confirmation click before calling onDelete', async () => {
    const onDelete = vi.fn();
    render(
      <FolderCard
        folder={folder()} venues={venues} expanded={false}
        onToggle={() => {}} onRename={() => {}} onDelete={onDelete}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /usuń folder/i }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /potwierdź usunięcie/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /potwierdź usunięcie/i }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('cancels the delete confirmation', async () => {
    const onDelete = vi.fn();
    render(
      <FolderCard
        folder={folder()} venues={venues} expanded={false}
        onToggle={() => {}} onRename={() => {}} onDelete={onDelete}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /usuń folder/i }));
    await userEvent.click(screen.getByRole('button', { name: /^anuluj$/i }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /potwierdź usunięcie/i })).not.toBeInTheDocument();
  });

  it('renders children only when expanded', () => {
    const { rerender } = render(
      <FolderCard folder={folder()} venues={venues} expanded={false}
        onToggle={() => {}} onRename={() => {}} onDelete={() => {}}>
        <div>EVENTS</div>
      </FolderCard>,
    );
    expect(screen.queryByText('EVENTS')).not.toBeInTheDocument();
    rerender(
      <FolderCard folder={folder()} venues={venues} expanded={true}
        onToggle={() => {}} onRename={() => {}} onDelete={() => {}}>
        <div>EVENTS</div>
      </FolderCard>,
    );
    expect(screen.getByText('EVENTS')).toBeInTheDocument();
  });
});
