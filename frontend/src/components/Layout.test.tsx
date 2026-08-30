/**
 * GOI-95: the footer exists to carry the two legal links, and they have to be
 * on every page — art. 8(1)(1) UŚUDE requires the regulamin to be *available*,
 * and a document you can only reach by typing its URL is not.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';

vi.mock('../lib/auth', () => ({ isLoggedIn: () => false, clearSessionToken: vi.fn() }));
vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ invalidate: vi.fn() }),
    auth: { logout: { useMutation: () => ({ mutate: vi.fn() }) } },
  },
}));

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<p>page body</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('Layout footer', () => {
  it('links to the privacy policy and the terms', () => {
    renderLayout();
    const footer = screen.getByRole('contentinfo');
    expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute('href', '/policy');
    expect(screen.getByRole('link', { name: /terms of use/i })).toHaveAttribute('href', '/terms');
    expect(footer).toContainElement(screen.getByRole('link', { name: /terms of use/i }));
  });

  /**
   * The bottom padding that clears the fixed mobile tab bar moved from `main`
   * to the footer when the footer arrived. On `main` it would now be a
   * permanent gap above the footer, and the footer itself would sit under the
   * tab bar — which is where the legal links would be.
   */
  it('carries the clearance for the fixed mobile tab bar', () => {
    renderLayout();
    expect(screen.getByRole('contentinfo').className).toContain('pb-24');
    expect(screen.getByRole('main').className).not.toContain('pb-24');
  });

  it('still renders the page it wraps', () => {
    renderLayout();
    expect(screen.getByText('page body')).toBeInTheDocument();
  });
});
