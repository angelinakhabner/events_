import { describe, it, expect, vi } from 'vitest';
import { clean, enrichDescriptions, extractDescription } from './enricher.js';

describe('extractDescription', () => {
  it('prefers OpenGraph og:description', () => {
    const html = `<html><head>
      <meta name="description" content="meta one">
      <meta property="og:description" content="og one">
    </head><body><p>p one</p></body></html>`;
    expect(extractDescription(html)).toBe('og one');
  });

  it('falls back to <meta name="description"> when og is absent', () => {
    const html = `<html><head>
      <meta name="description" content="meta describes the film">
    </head></html>`;
    expect(extractDescription(html)).toBe('meta describes the film');
  });

  it('falls back to the first substantive paragraph when no meta tags exist', () => {
    const html = `<html><body>
      <p>short</p>
      <article><p>This is the substantive paragraph that lives in the article body and describes the film at length.</p></article>
    </body></html>`;
    expect(extractDescription(html)).toMatch(/substantive paragraph/);
  });

  it('returns null when nothing useful is found', () => {
    const html = `<html><body><p>tiny</p></body></html>`;
    expect(extractDescription(html)).toBeNull();
  });

  it('collapses whitespace', () => {
    const html = `<html><head><meta property="og:description" content="line one\n line two   line three"></head></html>`;
    expect(extractDescription(html)).toBe('line one line two line three');
  });
});

describe('clean', () => {
  it('keeps short strings as-is', () => {
    expect(clean('Hello world.')).toBe('Hello world.');
  });

  it('caps at ~200 chars on a sentence boundary when possible', () => {
    const sentence = 'A'.repeat(120) + '. ' + 'B'.repeat(120) + '.';
    const out = clean(sentence);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith('.')).toBe(true);
  });

  it('cuts on a word boundary with an ellipsis when no sentence end is close enough', () => {
    const long = 'word '.repeat(200).trim();
    const out = clean(long);
    expect(out.length).toBeLessThanOrEqual(201); // 200 + '…'
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('enrichDescriptions', () => {
  function mkFetch(map: Record<string, string>): typeof fetch {
    return (async (url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      const body = map[u];
      if (body === undefined) return new Response('', { status: 404 });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
    }) as typeof fetch;
  }

  it('fills missing descriptions from per-event pages', async () => {
    const events = [
      { source_url: 'https://v.example/film/a', description: null },
      { source_url: 'https://v.example/film/b', description: null },
    ];
    const fetcher = mkFetch({
      'https://v.example/film/a': '<meta property="og:description" content="film A summary">',
      'https://v.example/film/b': '<meta property="og:description" content="film B summary">',
    });

    const r = await enrichDescriptions(events, { venueUrl: 'https://v.example/repertuar', fetcher });
    expect(events[0]!.description).toBe('film A summary');
    expect(events[1]!.description).toBe('film B summary');
    expect(r).toEqual({ enriched: 2, skipped: 0, failed: 0 });
  });

  it('reuses one fetch per unique source_url across multiple screenings', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response('<meta property="og:description" content="shared">', { status: 200 }),
    );
    const events = [
      { source_url: 'https://v.example/film/a', description: null },
      { source_url: 'https://v.example/film/a', description: null },
      { source_url: 'https://v.example/film/a', description: null },
    ];
    const r = await enrichDescriptions(events, {
      venueUrl: 'https://v.example/repertuar',
      fetcher: fetchSpy as unknown as typeof fetch,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(events.every((e) => e.description === 'shared')).toBe(true);
    expect(r.enriched).toBe(3);
  });

  it('skips events that already have a description', async () => {
    const fetchSpy = vi.fn(async () => new Response('', { status: 200 }));
    const events = [
      { source_url: 'https://v.example/film/a', description: 'already here' },
    ];
    const r = await enrichDescriptions(events, {
      venueUrl: 'https://v.example/repertuar',
      fetcher: fetchSpy as unknown as typeof fetch,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(events[0]!.description).toBe('already here');
    expect(r.skipped).toBe(1);
  });

  it('skips events whose source_url is the venue calendar', async () => {
    const fetchSpy = vi.fn(async () => new Response('', { status: 200 }));
    const events = [
      { source_url: 'https://v.example/repertuar', description: null },
      { source_url: 'https://V.Example/Repertuar/', description: null }, // normalised
    ];
    const r = await enrichDescriptions(events, {
      venueUrl: 'https://v.example/repertuar',
      fetcher: fetchSpy as unknown as typeof fetch,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r.skipped).toBe(2);
  });

  it('treats fetch failures as silent (description stays null, run counted)', async () => {
    const fetcher = (async () => { throw new Error('boom'); }) as typeof fetch;
    const events = [{ source_url: 'https://v.example/film/a', description: null }];
    const r = await enrichDescriptions(events, { venueUrl: 'https://v.example/repertuar', fetcher });
    expect(events[0]!.description).toBeNull();
    expect(r.failed).toBe(1);
    expect(r.enriched).toBe(0);
  });
});
