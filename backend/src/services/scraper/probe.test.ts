import { describe, it, expect } from 'vitest';
import { probeVenueUrl } from './probe.js';

const NOW = new Date('2026-07-01T10:00:00.000Z');

function htmlResponder(html: string): typeof fetch {
  return (async () => new Response(html, { status: 200 })) as typeof fetch;
}

function jsonLdPage(events: Array<{ name: string; startDate: string }>): string {
  const nodes = events.map((e) => ({
    '@context': 'https://schema.org',
    '@type': 'ScreeningEvent',
    name: e.name,
    startDate: e.startDate,
    url: `/event/${encodeURIComponent(e.name)}`,
  }));
  return `<!doctype html><html lang="pl-PL"><head>
    <title>Repertuar — Kino Przykład</title>
    <meta property="og:site_name" content="Kino Przykład" />
    <script type="application/ld+json">${JSON.stringify(nodes)}</script>
  </head><body><div>listing</div></body></html>`;
}

describe('probeVenueUrl', () => {
  it('detects structured data and counts upcoming events', async () => {
    const html = jsonLdPage([
      { name: 'Ojczyzna', startDate: '2026-07-10T19:00:00+02:00' },
      { name: 'Perfect Days', startDate: '2026-07-12T20:30:00+02:00' },
    ]);
    const res = await probeVenueUrl('https://kino.example/repertuar', {
      fetcher: htmlResponder(html),
      now: NOW,
    });
    expect(res).toEqual({
      ok: true,
      method: 'structured-data',
      eventCount: 2,
      reason: null,
      // Suggestions for the add-venue form: og:site_name wins over <title>,
      // <html lang> is normalized to the bare code.
      title: 'Kino Przykład',
      language: 'pl',
    });
  });

  it('falls back to "ai" when the page has readable content but no structured data', async () => {
    const body = `<p>${'Program kina na lipiec. '.repeat(40)}</p>`;
    const html = `<!doctype html><html><body><main>${body}</main></body></html>`;
    const res = await probeVenueUrl('https://kino.example/repertuar', {
      fetcher: htmlResponder(html),
      now: NOW,
    });
    expect(res.ok).toBe(true);
    expect(res.method).toBe('ai');
    expect(res.eventCount).toBeNull();
  });

  it('rejects an empty JS-shell page', async () => {
    const html = '<!doctype html><html><body><div id="app"></div></body></html>';
    const res = await probeVenueUrl('https://spa.example/', {
      fetcher: htmlResponder(html),
      now: NOW,
    });
    expect(res.ok).toBe(false);
    expect(res.method).toBeNull();
    expect(res.reason).toMatch(/JavaScript/i);
  });

  it('reports fetch failures with the underlying reason', async () => {
    const fakeFetch = (async () => new Response('gone', { status: 404 })) as typeof fetch;
    const res = await probeVenueUrl('https://dead.example/x', { fetcher: fakeFetch, now: NOW });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/Couldn't fetch/);
    expect(res.reason).toMatch(/404/);
  });
});
