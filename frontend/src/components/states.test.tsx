import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyState, ErrorState, SkeletonList } from './states';

describe('EmptyState', () => {
  it('renders the title and triggers the action button', async () => {
    const onClick = vi.fn();
    render(<EmptyState title="Nothing here" action={{ label: 'Reset', onClick }} />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onClick).toHaveBeenCalled();
  });
});

describe('ErrorState', () => {
  it('shows the message and calls onRetry', async () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Boom" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('SkeletonList', () => {
  it('exposes a loading status', () => {
    render(<SkeletonList rows={2} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
