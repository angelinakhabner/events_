import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DevGate } from './DevGate';

// SHA-256("secret")
const SECRET_HASH = '2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b';

describe('DevGate', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllEnvs());

  it('renders children directly when no gate hash is configured', () => {
    vi.stubEnv('VITE_DEV_GATE_HASH', '');
    render(<DevGate>app content</DevGate>);
    expect(screen.getByText('app content')).toBeInTheDocument();
  });

  it('blocks children behind a password form when a gate hash is set', () => {
    vi.stubEnv('VITE_DEV_GATE_HASH', SECRET_HASH);
    render(<DevGate>app content</DevGate>);
    expect(screen.queryByText('app content')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Dev access password')).toBeInTheDocument();
  });

  it('unlocks with the right password and persists the unlock', async () => {
    vi.stubEnv('VITE_DEV_GATE_HASH', SECRET_HASH);
    const user = userEvent.setup();
    render(<DevGate>app content</DevGate>);

    await user.type(screen.getByLabelText('Dev access password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Enter' }));

    expect(await screen.findByText('app content')).toBeInTheDocument();
    expect(localStorage.getItem('goin-dev-gate')).toBe(SECRET_HASH);
  });

  it('shows an error on a wrong password and stays locked', async () => {
    vi.stubEnv('VITE_DEV_GATE_HASH', SECRET_HASH);
    const user = userEvent.setup();
    render(<DevGate>app content</DevGate>);

    await user.type(screen.getByLabelText('Dev access password'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Enter' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong password.');
    expect(screen.queryByText('app content')).not.toBeInTheDocument();
  });

  it('skips the form when the unlock is already stored', () => {
    vi.stubEnv('VITE_DEV_GATE_HASH', SECRET_HASH);
    localStorage.setItem('goin-dev-gate', SECRET_HASH);
    render(<DevGate>app content</DevGate>);
    expect(screen.getByText('app content')).toBeInTheDocument();
  });
});
