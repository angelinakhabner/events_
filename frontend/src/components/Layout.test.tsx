import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';

vi.mock('../lib/auth', () => ({ isLoggedIn: () => false, clearSessionToken: () => {} }));
vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ invalidate: () => Promise.resolve() }),
    auth: { logout: { useMutation: () => ({ mutate: () => {} }) } },
  },
}));

function renderLayout() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Layout />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Layout wordmark', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('shows the plain AFISZ wordmark outside the dev preview', () => {
    vi.stubEnv('VITE_APP_VARIANT', '');
    renderLayout();
    expect(screen.getByText('AFISZ')).toBeInTheDocument();
    expect(screen.queryByText('DEV')).not.toBeInTheDocument();
  });

  it('marks the wordmark with a DEV chip in the dev-preview build', () => {
    vi.stubEnv('VITE_APP_VARIANT', 'dev');
    renderLayout();
    expect(screen.getByText('AFISZ')).toBeInTheDocument();
    expect(screen.getByText('DEV')).toBeInTheDocument();
  });
});
