import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { InviteGate } from './InviteGate';
import { LANDING_ID } from '../landing/id';
import { gateWasOpen } from '../lib/landing';

/**
 * The client half of the gate (GOI-83). The server is the actual boundary —
 * these assertions are about what a visitor without an invite can *see* and
 * what the app *does* before it knows.
 *
 * Since the public landing page lives in index.html rather than in React
 * (src/landing/render.ts), "what a stranger sees" is now a question about the
 * element the gate leaves alone, so the tests put one in the document.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  document.body.innerHTML = `<div id="${LANDING_ID}">PUBLIC LANDING PAGE</div>`;
});
afterEach(() => vi.unstubAllGlobals());

function App() {
  return <main>SECRET APP SHELL</main>;
}

function landingShown(): boolean {
  const el = document.getElementById(LANDING_ID);
  return !!el && !el.hasAttribute('hidden');
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

  it('draws the curtain over the landing page for an invited visitor', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ open: true }) });
    render(<InviteGate><App /></InviteGate>);
    await screen.findByText('SECRET APP SHELL');
    expect(landingShown()).toBe(false);
  });

  it('leaves the public landing page up, and the app out of reach, without an invite', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ open: false }) });
    render(<InviteGate><App /></InviteGate>);

    await waitFor(() => expect(landingShown()).toBe(true));
    expect(screen.queryByText('SECRET APP SHELL')).not.toBeInTheDocument();
  });

  // A redirect after mount would already have leaked the layout and spent a
  // round of queries. Nothing renders until the answer is in — and the page
  // the browser was served stays exactly as it was.
  it('renders nothing at all while the answer is in flight', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { container } = render(<InviteGate><App /></InviteGate>);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('SECRET APP SHELL')).not.toBeInTheDocument();
    expect(landingShown()).toBe(true);
  });

  it('fails closed when the API is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    render(<InviteGate><App /></InviteGate>);

    await waitFor(() => expect(landingShown()).toBe(true));
    expect(screen.queryByText('SECRET APP SHELL')).not.toBeInTheDocument();
  });

  it('fails closed on a non-OK response', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ open: true }) });
    render(<InviteGate><App /></InviteGate>);
    await waitFor(() => expect(landingShown()).toBe(true));
    expect(screen.queryByText('SECRET APP SHELL')).not.toBeInTheDocument();
  });

  // The hint that lets a returning invited visitor skip the flash of the
  // landing page (see main.tsx) — and that must be dropped the moment the
  // invite stops working, or they would stare at a blank page instead.
  it('remembers a working invite, and forgets a revoked one', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ open: true }) });
    const { unmount } = render(<InviteGate><App /></InviteGate>);
    await screen.findByText('SECRET APP SHELL');
    expect(gateWasOpen()).toBe(true);
    unmount();

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ open: false }) });
    render(<InviteGate><App /></InviteGate>);
    await waitFor(() => expect(gateWasOpen()).toBe(false));
  });
});
