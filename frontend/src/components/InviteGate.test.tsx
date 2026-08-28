import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { InviteGate } from './InviteGate';

/**
 * The client half of the gate (GOI-83). The server is the actual boundary —
 * these assertions are about what a visitor without an invite can *see* and
 * what the app *does* before it knows.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function App() {
  return <main>SECRET APP SHELL</main>;
}

describe('InviteGate', () => {
  it('renders the app once the API confirms an invite', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ open: true }) });
    render(<InviteGate><App /></InviteGate>);
    expect(await screen.findByText('SECRET APP SHELL')).toBeInTheDocument();
  });

  it('sends credentials, or the cookie never leaves the browser', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ open: true }) });
    render(<InviteGate><App /></InviteGate>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: 'include' });
  });

  it('shows only "not available" without an invite', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ open: false }) });
    render(<InviteGate><App /></InviteGate>);

    expect(await screen.findByText(/not available/i)).toBeInTheDocument();
    expect(screen.queryByText('SECRET APP SHELL')).not.toBeInTheDocument();
  });

  // A redirect after mount would already have leaked the layout and spent a
  // round of queries. Nothing renders until the answer is in.
  it('renders nothing at all while the answer is in flight', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { container } = render(<InviteGate><App /></InviteGate>);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('SECRET APP SHELL')).not.toBeInTheDocument();
  });

  it('fails closed when the API is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    render(<InviteGate><App /></InviteGate>);

    expect(await screen.findByText(/not available/i)).toBeInTheDocument();
    expect(screen.queryByText('SECRET APP SHELL')).not.toBeInTheDocument();
  });

  it('fails closed on a non-OK response', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ open: true }) });
    render(<InviteGate><App /></InviteGate>);
    expect(await screen.findByText(/not available/i)).toBeInTheDocument();
  });

  // Nothing here should tell a stranger what the site is.
  it('gives away nothing about the app on the closed page', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ open: false }) });
    const { container } = render(<InviteGate><App /></InviteGate>);
    await screen.findByText(/not available/i);
    expect(container.textContent).toBe('Not available.');
  });
});

/**
 * GOI-95. The terms and the privacy notice are what someone reads to decide
 * whether to sign up, so they cannot sit behind the thing you get by signing
 * up. Art. 8(1)(1) UŚUDE requires the regulamin to be available *before* the
 * contract; RODO art. 12–13 says the same of the notice.
 *
 * The exception is exactly two paths, and it must not become a hole: the app
 * shell stays hidden on every other path, including ones that merely look
 * legal.
 */
describe('InviteGate — the legal pages are in front of the gate', () => {
  const original = window.location.pathname;

  function at(path: string) {
    window.history.replaceState({}, '', path);
  }
  afterEach(() => at(original));

  it('serves the privacy policy without an invite', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ open: false }) });
    at('/policy');
    render(<InviteGate><App /></InviteGate>);

    expect(await screen.findByRole('heading', { name: 'Privacy policy', level: 1 })).toBeInTheDocument();
    expect(screen.queryByText(/not available/i)).not.toBeInTheDocument();
  });

  it('serves the terms without an invite', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ open: false }) });
    at('/terms');
    render(<InviteGate><App /></InviteGate>);

    expect(await screen.findByRole('heading', { name: 'Terms of use', level: 1 })).toBeInTheDocument();
  });

  // The gate is still the gate. Rendering the legal pages must not drag the
  // app's own routes along with them.
  it('still hides the app shell on those paths', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ open: false }) });
    at('/policy');
    render(<InviteGate><App /></InviteGate>);

    await screen.findByRole('heading', { name: 'Privacy policy', level: 1 });
    expect(screen.queryByText('SECRET APP SHELL')).not.toBeInTheDocument();
  });

  it('is two exact paths, not a prefix', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ open: false }) });
    at('/policy-and-everything-else');
    render(<InviteGate><App /></InviteGate>);

    expect(await screen.findByText(/not available/i)).toBeInTheDocument();
    expect(screen.queryByText('SECRET APP SHELL')).not.toBeInTheDocument();
  });

  it('lets the app through on those paths once there is an invite', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ open: true }) });
    at('/policy');
    render(<InviteGate><App /></InviteGate>);

    // With an invite the gate is transparent — routing is the app's business.
    expect(await screen.findByText('SECRET APP SHELL')).toBeInTheDocument();
  });
});
