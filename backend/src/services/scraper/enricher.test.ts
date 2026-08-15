import { describe, it, expect, vi } from 'vitest';
import { clean, enrichDescriptions, extractDescription } from './enricher.js';
import { normalize } from './describer.js';

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

  /** No real waiting in tests; the delay's *existence* is asserted separately. */
  const base = { venueUrl: 'https://v.example/repertuar', delayMs: 0 };

  it('fills missing descriptions from per-event pages', async () => {
    const events = [
      { source_url: 'https://v.example/film/a', description: null },
      { source_url: 'https://v.example/film/b', description: null },
    ];
    const fetcher = mkFetch({
      'https://v.example/film/a': '<meta property="og:description" content="film A summary">',
      'https://v.example/film/b': '<meta property="og:description" content="film B summary">',
    });

    const r = await enrichDescriptions(events, { ...base, fetcher });
    expect(events[0]!.description).toBe('film A summary');
    expect(events[1]!.description).toBe('film B summary');
    expect(r).toMatchObject({ enriched: 2, skipped: 0, failed: 0, fetched: 2, capped: 0 });
  });

  // GOI-79: a show playing three times is one page, so it is one fetch.
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
      ...base,
      fetcher: fetchSpy as unknown as typeof fetch,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(events.every((e) => e.description === 'shared')).toBe(true);
    expect(r.enriched).toBe(3);
    expect(r.fetched).toBe(1);
  });

  it('skips events that already have a description', async () => {
    const fetchSpy = vi.fn(async () => new Response('', { status: 200 }));
    const events = [{ source_url: 'https://v.example/film/a', description: 'already here' }];
    const r = await enrichDescriptions(events, {
      ...base,
      fetcher: fetchSpy as unknown as typeof fetch,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(events[0]!.description).toBe('already here');
    expect(r.skipped).toBe(1);
  });

  // Teatr Żydowski's listing has rows like this. They keep a null description
  // and must not cause a request.
  it('skips events whose source_url is the venue calendar — no detail page exists', async () => {
    const fetchSpy = vi.fn(async () => new Response('', { status: 200 }));
    const events = [
      { source_url: 'https://v.example/repertuar', description: null },
      { source_url: 'https://V.Example/Repertuar/', description: null }, // normalised
      { source_url: '', description: null },
    ];
    const r = await enrichDescriptions(events, {
      ...base,
      fetcher: fetchSpy as unknown as typeof fetch,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r.skipped).toBe(3);
    expect(events.every((e) => e.description === null)).toBe(true);
  });

  it('survives a 404 on the detail page: row keeps a null description, run continues', async () => {
    const events = [
      { source_url: 'https://v.example/film/gone', description: null },
      { source_url: 'https://v.example/film/ok', description: null },
    ];
    const fetcher = mkFetch({
      'https://v.example/film/ok': '<meta property="og:description" content="still works">',
    });

    const r = await enrichDescriptions(events, { ...base, fetcher });
    expect(events[0]!.description).toBeNull();
    // The failure must not stop the pass.
    expect(events[1]!.description).toBe('still works');
    expect(r.failed).toBe(1);
    expect(r.enriched).toBe(1);
  });

  it('treats a thrown fetch as a failure without throwing', async () => {
    const fetcher = (async () => { throw new Error('boom'); }) as typeof fetch;
    const events = [{ source_url: 'https://v.example/film/a', description: null }];
    const r = await enrichDescriptions(events, { ...base, fetcher });
    expect(events[0]!.description).toBeNull();
    expect(r.failed).toBe(1);
    expect(r.enriched).toBe(0);
  });
});

describe('enrichDescriptions — cost control (GOI-79)', () => {
  const ok = (_url?: unknown) =>
    new Response('<meta property="og:description" content="desc">', { status: 200 });

  it('does not fetch a detail page already stored with a description', async () => {
    const fetchSpy = vi.fn(async (url?: unknown) => ok(url));
    const events = [
      { source_url: 'https://v.example/film/known', description: null },
      { source_url: 'https://v.example/film/new', description: null },
    ];

    const r = await enrichDescriptions(events, {
      venueUrl: 'https://v.example/repertuar',
      delayMs: 0,
      fetcher: fetchSpy as unknown as typeof fetch,
      alreadyDescribed: async () => new Set(['https://v.example/film/known']),
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]![0]).toBe('https://v.example/film/new');
    // The known row is left alone, not blanked.
    expect(events[0]!.description).toBeNull();
    expect(events[1]!.description).toBe('desc');
    expect(r.fetched).toBe(1);
  });

  it('enriches everything rather than nothing when the lookup itself fails', async () => {
    const fetchSpy = vi.fn(ok);
    const events = [{ source_url: 'https://v.example/film/a', description: null }];

    const r = await enrichDescriptions(events, {
      venueUrl: 'https://v.example/repertuar',
      delayMs: 0,
      fetcher: fetchSpy as unknown as typeof fetch,
      alreadyDescribed: async () => { throw new Error('db down'); },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(r.enriched).toBe(1);
  });

  it('stops at the per-run cap, leaving the rest null, and the run still succeeds', async () => {
    const fetchSpy = vi.fn(ok);
    const events = Array.from({ length: 5 }, (_, i) => ({
      source_url: `https://v.example/film/${i}`,
      description: null as string | null,
    }));

    const r = await enrichDescriptions(events, {
      venueUrl: 'https://v.example/repertuar',
      delayMs: 0,
      fetcher: fetchSpy as unknown as typeof fetch,
      maxFetches: 2,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(r.fetched).toBe(2);
    expect(r.capped).toBe(3);
    expect(r.enriched).toBe(2);
    expect(events.slice(2).every((e) => e.description === null)).toBe(true);
  });

  // Sequential and spaced, not parallel: these are small venue servers, and a
  // burst of concurrent requests is what gets a scraper blocked.
  it('fetches one at a time, pausing between pages', async () => {
    const order: string[] = [];
    const fetchSpy = vi.fn(async (url: unknown) => {
      order.push(`fetch:${url}`);
      return ok();
    });
    const sleep = vi.fn(async (ms: number) => { order.push(`sleep:${ms}`); });

    await enrichDescriptions(
      [
        { source_url: 'https://v.example/a', description: null },
        { source_url: 'https://v.example/b', description: null },
        { source_url: 'https://v.example/c', description: null },
      ],
      {
        venueUrl: 'https://v.example/repertuar',
        fetcher: fetchSpy as unknown as typeof fetch,
        delayMs: 1000,
        sleep,
      },
    );

    // No delay before the first page; one between each pair after that.
    expect(order).toEqual([
      'fetch:https://v.example/a',
      'sleep:1000',
      'fetch:https://v.example/b',
      'sleep:1000',
      'fetch:https://v.example/c',
    ]);
  });
});

describe('enrichDescriptions — model extraction (GOI-79)', () => {
  const page =
    '<html><body><nav>Menu Bilety Kontakt</nav><article><p>' +
    'Spektakl o rodzinie, która zbiera się po latach na weselu w podwarszawskiej wsi. ' +
    'Reżyseria: Jan Kowalski. Premiera odbyła się w zeszłym sezonie.' +
    '</p></article><footer>Adres i godziny otwarcia</footer></body></html>';

  const respond = () => new Response(page, { status: 200 });

  it('sends the stripped main content and stores what the model returns', async () => {
    const describe_ = vi.fn(async (_args: { text: string; url: string }) => ({
      description: 'Spektakl o rodzinie zbierającej się na weselu.',
      inputTokens: 120,
      outputTokens: 20,
    }));
    const events = [{ source_url: 'https://v.example/a', description: null }];

    const r = await enrichDescriptions(events, {
      venueUrl: 'https://v.example/repertuar',
      delayMs: 0,
      fetcher: (async () => respond()) as unknown as typeof fetch,
      client: { describe: describe_ },
    });

    expect(describe_).toHaveBeenCalledTimes(1);
    const sent = describe_.mock.calls[0]![0];
    expect(sent.text).toMatch(/Spektakl o rodzinie/);
    // Chrome is stripped before we pay for the tokens.
    expect(sent.text).not.toMatch(/Bilety|godziny otwarcia/);

    expect(events[0]!.description).toBe('Spektakl o rodzinie zbierającej się na weselu.');
    expect(r.inputTokens).toBe(120);
    expect(r.outputTokens).toBe(20);
  });

  it('falls back to the page’s own meta when the model returns nothing', async () => {
    const withMeta =
      '<html><head><meta property="og:description" content="Opis ze strony"></head>' +
      '<body><article><p>' + 'x'.repeat(200) + '</p></article></body></html>';
    const events = [{ source_url: 'https://v.example/a', description: null }];

    await enrichDescriptions(events, {
      venueUrl: 'https://v.example/repertuar',
      delayMs: 0,
      fetcher: (async () => new Response(withMeta, { status: 200 })) as unknown as typeof fetch,
      client: { describe: async () => ({ description: null, inputTokens: 5, outputTokens: 1 }) },
    });

    expect(events[0]!.description).toBe('Opis ze strony');
  });

  it('keeps the meta description when the model call throws', async () => {
    const withMeta =
      '<html><head><meta property="og:description" content="Opis ze strony"></head>' +
      '<body><article><p>' + 'x'.repeat(200) + '</p></article></body></html>';
    const events = [{ source_url: 'https://v.example/a', description: null }];

    const r = await enrichDescriptions(events, {
      venueUrl: 'https://v.example/repertuar',
      delayMs: 0,
      fetcher: (async () => new Response(withMeta, { status: 200 })) as unknown as typeof fetch,
      client: { describe: async () => { throw new Error('rate limited'); } },
    });

    expect(events[0]!.description).toBe('Opis ze strony');
    expect(r.failed).toBe(1);
  });
});

describe('normalize (describer)', () => {
  it('treats the model’s "NONE" as no description, not as text', () => {
    expect(normalize('NONE')).toBeNull();
    expect(normalize('none.')).toBeNull();
    expect(normalize('  ')).toBeNull();
  });

  it('strips wrapping quotes and collapses whitespace', () => {
    expect(normalize('"Spektakl  o\n rodzinie."')).toBe('Spektakl o rodzinie.');
  });

  it('keeps a real description', () => {
    expect(normalize('A play about a wedding.')).toBe('A play about a wedding.');
  });
});
