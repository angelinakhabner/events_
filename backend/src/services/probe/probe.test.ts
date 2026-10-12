import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ProbeOutcome, ProbeSampleEvent } from '@afisz/shared';
import { probeVenueUrl } from './index.js';
import type { PaidFetcher } from './paid.js';

/**
 * The probe ladder end to end (GOI-72 §8), against real HTML fixtures with
 * every network call mocked.
 *
 * `fetchImpl` is the only way out of this module, and every test supplies one
 * that answers from a route table and throws on anything unrouted — so a test
 * that would have hit the internet fails loudly instead of silently passing on
 * someone's live site.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../../test/fixtures/probe');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

const HTML = { 'content-type': 'text/html; charset=utf-8' };
const JSON_CT = { 'content-type': 'application/json' };
const XML = { 'content-type': 'application/xml' };
const ICS = { 'content-type': 'text/calendar' };

type Route = { body: string; headers?: Record<string, string>; status?: number };

/** A fetch built from an exact-URL route table. Anything unrouted 404s, which
 *  is what a real site does for a guessed path — and nothing escapes. */
function routedFetch(routes: Record<string, Route>) {
  const calls: string[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(url);
    const route = routes[url];
    if (!route) {
      return new Response('not found', { status: 404, headers: HTML });
    }
    return new Response(route.body, {
      status: route.status ?? 200,
      headers: route.headers ?? HTML,
    });
  });
  return { impl: impl as unknown as typeof fetch, calls, mock: impl };
}

/** A mocked Claude. The cost guard is asserted on its call count. */
function stubExtractor(events: ProbeSampleEvent[] = []) {
  return vi.fn(async () => events);
}

function stubPaidFetcher(markdown = '# Program\n\n12 września 19:00 Wesele'): PaidFetcher & {
  fetchRendered: ReturnType<typeof vi.fn>;
} {
  return { fetchRendered: vi.fn(async () => ({ markdown, credits: 1 })) } as never;
}

const NOW = new Date('2026-08-15T10:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('detector A — JSON-LD', () => {
  it('reads a single Event node and suggests the venue name from og:site_name', async () => {
    const { impl } = routedFetch({
      'https://teatr.example/': { body: fixture('jsonld-single-event.html') },
    });
    const res = await probeVenueUrl('teatr.example', { fetchImpl: impl, now: NOW });

    expect(res.status).toBe('success');
    if (res.status !== 'success') return;
    expect(res.method).toBe('jsonld');
    expect(res.confidence).toBe('high');
    expect(res.suggestedName).toBe('Teatr Przykładowy');
    expect(res.language).toBe('pl');
    expect(res.sampleEvents.map((e) => e.title)).toEqual(['Wesele']);
  });

  it('finds events nested in a @graph, including Festival', async () => {
    const { impl } = routedFetch({
      'https://klub.example/': { body: fixture('jsonld-graph-array.html') },
    });
    const res = await probeVenueUrl('klub.example', { fetchImpl: impl, now: NOW });

    expect(res.status).toBe('success');
    if (res.status !== 'success') return;
    // Festival carries no "event" in its type name — a /event/i match misses it.
    expect(res.sampleEvents.map((e) => e.title)).toEqual(['Koncert Jesienny', 'Festiwal Zimowy']);
  });

  it('unwraps an ItemList of ListItem → Event', async () => {
    const { impl } = routedFetch({
      'https://kino.example/': { body: fixture('jsonld-itemlist.html') },
    });
    const res = await probeVenueUrl('kino.example', { fetchImpl: impl, now: NOW });

    expect(res.status).toBe('success');
    if (res.status !== 'success') return;
    expect(res.method).toBe('jsonld');
    expect(res.sampleEvents).toHaveLength(2);
  });
});

describe('detector precedence (GOI-72 §8)', () => {
  it('resolves a page carrying both JSON-LD and an RSS link to jsonld', async () => {
    const { impl, calls } = routedFetch({
      'https://both.example/': { body: fixture('jsonld-and-rss.html') },
      'https://both.example/feed/': { body: fixture('rss-feed.xml'), headers: XML },
    });
    const res = await probeVenueUrl('both.example', { fetchImpl: impl, now: NOW });

    expect(res.status).toBe('success');
    if (res.status !== 'success') return;
    expect(res.method).toBe('jsonld');
    // First hit wins means the feed is never even requested.
    expect(calls).not.toContain('https://both.example/feed/');
  });
});

describe('detector B — iCal', () => {
  it('parses a Tribe .ics feed, unfolding continuation lines', async () => {
    const { impl } = routedFetch({
      'https://venue.example/': {
        body: '<html lang="pl"><head><title>Venue</title><link rel="alternate" type="text/calendar" href="/events.ics"></head><body>Program</body></html>',
      },
      'https://venue.example/events.ics': { body: fixture('ical-tribe.ics'), headers: ICS },
    });
    const res = await probeVenueUrl('venue.example', { fetchImpl: impl, now: NOW });

    expect(res.status).toBe('success');
    if (res.status !== 'success') return;
    expect(res.method).toBe('ical');
    expect(res.confidence).toBe('high');
    expect(res.sampleEvents[0]).toEqual({
      title: 'Koncert w Piwnicy',
      startsAt: '2026-11-15T19:00:00.000Z',
    });
    // The folded SUMMARY must come back whole.
    expect(res.sampleEvents[1]?.title).toBe('Spektakl z bardzo długim tytułem który zawija się na drugą linię');
  });

  it('keeps DTSTART;VALUE=DATE undated — the exhibition case', async () => {
    const { impl } = routedFetch({
      'https://muzeum.example/': {
        body: '<html lang="pl"><head><title>Muzeum</title></head><body>Wystawy</body></html>',
      },
      'https://muzeum.example/?ical=1': { body: fixture('ical-date-only.ics'), headers: ICS },
    });
    const res = await probeVenueUrl('muzeum.example', { fetchImpl: impl, now: NOW });

    expect(res.status).toBe('success');
    if (res.status !== 'success') return;
    expect(res.method).toBe('ical');
    // A date-only run must not be given a fabricated midnight.
    expect(res.sampleEvents[0]).toEqual({ title: 'Wystawa stała', startsAt: null });
  });
});

describe('detector C — WordPress REST', () => {
  it('accepts the Tribe endpoint and decodes entity-escaped titles', async () => {
    const { impl } = routedFetch({
      'https://wp.example/': {
        body: '<html lang="pl"><head><title>WP</title></head><body>Wydarzenia</body></html>',
      },
      [`https://wp.example/wp-json/tribe/events/v1/events?per_page=20&start_date=2026-08-15`]: {
        body: fixture('wp-tribe-events.json'),
        headers: JSON_CT,
      },
    });
    const res = await probeVenueUrl('wp.example', { fetchImpl: impl, now: NOW });

    expect(res.status).toBe('success');
    if (res.status !== 'success') return;
    expect(res.method).toBe('wp_rest');
    expect(res.confidence).toBe('high');
    expect(res.sampleEvents.map((e) => e.title)).toEqual([
      'Stand-up: Otwarty mikrofon',
      'Kabaret – premiera',
    ]);
  });

  it('records plain posts as a low-confidence hint, not as event data', async () => {
    const { impl } = routedFetch({
      'https://blog.example/': {
        body: '<html lang="pl"><head><title>Blog</title></head><body>Aktualności</body></html>',
      },
      'https://blog.example/wp-json/wp/v2/posts?per_page=20': {
        body: fixture('wp-posts-only.json'),
        headers: JSON_CT,
      },
    });
    const res = await probeVenueUrl('blog.example', { fetchImpl: impl, now: NOW });

    expect(res.status).toBe('success');
    if (res.status !== 'success') return;
    expect(res.method).toBe('wp_rest_posts');
    expect(res.confidence).toBe('low');
    // Posts carry no trustworthy date field — they go to the extractor, so the
    // sample deliberately shows none.
    expect(res.sampleEvents.every((e) => e.startsAt === null)).toBe(true);
    expect(res.sampleEvents[0]?.title).toBe('Nowy sezon & zapowiedzi');
  });
});

describe('detector D — RSS', () => {
  it('parses feed items, CDATA included', async () => {
    const { impl } = routedFetch({
      'https://feed.example/': {
        body: '<html lang="pl"><head><title>Feed</title><link rel="alternate" type="application/rss+xml" href="/feed/"></head><body>News</body></html>',
      },
      'https://feed.example/feed/': { body: fixture('rss-feed.xml'), headers: XML },
    });
    const res = await probeVenueUrl('feed.example', { fetchImpl: impl, now: NOW });

    expect(res.status).toBe('success');
    if (res.status !== 'success') return;
    expect(res.method).toBe('rss');
    expect(res.confidence).toBe('medium');
    expect(res.sampleEvents.map((e) => e.title)).toEqual(['Premiera: Dziady', 'Koncert & recital']);
  });
});

describe('detector E — the extractor, and the cost guard', () => {
  it('extracts from a dated page with no structured data', async () => {
    const { impl } = routedFetch({
      'https://plain.example/': { body: fixture('plain-html-dated.html') },
    });
    const extract = stubExtractor([{ title: 'Wesele', startsAt: '2026-09-12T17:00:00.000Z' }]);

    const res = await probeVenueUrl('plain.example', { fetchImpl: impl, now: NOW, extract });

    expect(res.status).toBe('success');
    if (res.status !== 'success') return;
    expect(res.method).toBe('llm_extract');
    expect(res.confidence).toBe('medium');
    expect(extract).toHaveBeenCalledTimes(1);
  });

  // The whole point of the date-density gate: a page that can't contain events
  // must not cost a model call.
  it('never calls the extractor on a page with no dates', async () => {
    const { impl } = routedFetch({
      'https://restauracja.example/': { body: fixture('menu-page.html') },
    });
    const extract = stubExtractor();

    const res = await probeVenueUrl('restauracja.example', { fetchImpl: impl, now: NOW, extract });

    expect(extract).toHaveBeenCalledTimes(0);
    expect(res.status).toBe('needs_decision');
    if (res.status === 'success') return;
    expect(res.code).toBe('NO_EVENTS_FOUND');
  });
});

describe('detector F — diagnosis', () => {
  it('sends a JS-rendered shell to the paid decision instead of failing', async () => {
    const { impl } = routedFetch({
      'https://spa.example/': { body: fixture('spa-shell.html') },
    });
    const extract = stubExtractor();
    const paid = stubPaidFetcher();

    const res = await probeVenueUrl('spa.example', {
      fetchImpl: impl, now: NOW, extract, paidFetcher: paid,
    });

    expect(res.status).toBe('needs_decision');
    if (res.status === 'success') return;
    expect(res.code).toBe('JS_RENDERED_NEEDS_PAID');
    expect(res.severity).toBe('needs_decision');
    // allowPaid defaults off, so the vendor is untouched.
    expect(paid.fetchRendered).toHaveBeenCalledTimes(0);
    expect(extract).toHaveBeenCalledTimes(0);
  });

  it('names an archive as PAST_EVENTS_ONLY rather than "no events"', async () => {
    const { impl } = routedFetch({
      'https://archiwum.example/': { body: fixture('past-events-only.html') },
    });
    // No extractor wired: the page's dates are real but all historic, and the
    // diagnosis must reach the right code regardless.
    const res = await probeVenueUrl('archiwum.example', { fetchImpl: impl, now: NOW });

    expect(res.status).toBe('needs_decision');
    if (res.status === 'success') return;
    expect(res.code).toBe('PAST_EVENTS_ONLY');
  });
});

describe('paid tier (GOI-72 §4)', () => {
  it('renders exactly once with consent, and reuses the free path’s extractor', async () => {
    const { impl } = routedFetch({
      'https://spa.example/': { body: fixture('spa-shell.html') },
    });
    const extract = stubExtractor([{ title: 'Wesele', startsAt: null }]);
    const paid = stubPaidFetcher();

    const res = await probeVenueUrl('spa.example', {
      fetchImpl: impl, now: NOW, extract, paidFetcher: paid, allowPaid: true,
    });

    expect(paid.fetchRendered).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(res.status).toBe('success');
    if (res.status !== 'success') return;
    expect(res.method).toBe('firecrawl');
  });

  it('reports PAID_QUOTA_EXCEEDED when the deployment has no paid fetcher', async () => {
    const { impl } = routedFetch({
      'https://spa.example/': { body: fixture('spa-shell.html') },
    });
    const res = await probeVenueUrl('spa.example', {
      fetchImpl: impl, now: NOW, extract: stubExtractor(), paidFetcher: null, allowPaid: true,
    });

    expect(res.status).toBe('failure');
    if (res.status === 'success') return;
    expect(res.code).toBe('PAID_QUOTA_EXCEEDED');
  });

  it('maps a vendor failure to PAID_FETCH_FAILED, not a stack trace', async () => {
    const { impl } = routedFetch({
      'https://spa.example/': { body: fixture('spa-shell.html') },
    });
    const paid = { fetchRendered: vi.fn(async () => { throw new Error('Firecrawl responded 502'); }) };

    const res = await probeVenueUrl('spa.example', {
      fetchImpl: impl, now: NOW, extract: stubExtractor(), paidFetcher: paid as never, allowPaid: true,
    });

    expect(res.status).toBe('failure');
    if (res.status === 'success') return;
    expect(res.code).toBe('PAID_FETCH_FAILED');
    expect(res.message).not.toMatch(/502|Error/);
  });
});

describe('candidate discovery (GOI-72 §2)', () => {
  it('follows a homepage’s "Repertuar" link to the page that actually has events', async () => {
    const { impl, calls } = routedFetch({
      'https://teatr2.example/': { body: fixture('homepage-with-events-link.html') },
      'https://teatr2.example/repertuar': { body: fixture('jsonld-single-event.html') },
    });
    const res = await probeVenueUrl('teatr2.example', { fetchImpl: impl, now: NOW });

    expect(res.status).toBe('success');
    if (res.status !== 'success') return;
    expect(res.sourceUrl).toBe('https://teatr2.example/repertuar');
    // The pasted URL stays the dedup key even though a deeper page was used.
    expect(res.normalizedUrl).toBe('https://teatr2.example/');
    // Same-origin only: the ticketing link is never fetched.
    expect(calls.some((c) => c.startsWith('https://bilety.example'))).toBe(false);
  });

  it('picks listing URLs out of a sitemap, shallowest first', async () => {
    const { impl } = routedFetch({
      'https://sitemapped.example/': {
        body: '<html lang="pl"><head><title>Venue</title></head><body>Witamy</body></html>',
      },
      'https://sitemapped.example/sitemap.xml': {
        body: fixture('sitemap.xml').replace(/venue\.example/g, 'sitemapped.example'),
        headers: XML,
      },
      'https://sitemapped.example/wydarzenia': { body: fixture('jsonld-single-event.html') },
    });
    const res = await probeVenueUrl('sitemapped.example', { fetchImpl: impl, now: NOW });

    expect(res.status).toBe('success');
    if (res.status !== 'success') return;
    expect(res.sourceUrl).toBe('https://sitemapped.example/wydarzenia');
  });
});

describe('transport failures map to codes, never to raw output', () => {
  it('403 is BLOCKED — the site works and is refusing us', async () => {
    const { impl } = routedFetch({
      'https://waf.example/': { body: 'Forbidden', status: 403 },
    });
    const res = await probeVenueUrl('waf.example', { fetchImpl: impl, now: NOW });

    expect(res.status).toBe('failure');
    if (res.status === 'success') return;
    expect(res.code).toBe('BLOCKED');
    expect(res.severity).toBe('retryable');
  });

  it('a 500 is UNREACHABLE', async () => {
    const { impl } = routedFetch({
      'https://down.example/': { body: 'oops', status: 500 },
    });
    const res = await probeVenueUrl('down.example', { fetchImpl: impl, now: NOW });
    expect(res.status === 'failure' && res.code).toBe('UNREACHABLE');
  });

  it('a PDF is NOT_HTML', async () => {
    const { impl } = routedFetch({
      'https://plik.example/program.pdf': {
        body: '%PDF-1.4',
        headers: { 'content-type': 'application/pdf' },
      },
    });
    const res = await probeVenueUrl('https://plik.example/program.pdf', { fetchImpl: impl, now: NOW });
    expect(res.status === 'failure' && res.code).toBe('NOT_HTML');
  });

  it('a hanging site produces PROBE_TIMEOUT rather than a hung request', async () => {
    const impl = (async (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        // Resolve only when aborted — exactly how a dead socket behaves.
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      })) as unknown as typeof fetch;

    const res = await probeVenueUrl('slow.example', { fetchImpl: impl, now: NOW });
    expect(res.status === 'failure' && res.code).toBe('PROBE_TIMEOUT');
  }, 20_000);

  it('refuses a redirect into a private range even from a public host', async () => {
    const impl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://redirector.example/') {
        return new Response('', { status: 302, headers: { location: 'http://169.254.169.254/' } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const res = await probeVenueUrl('redirector.example', { fetchImpl: impl, now: NOW });
    expect(res.status === 'failure' && res.code).toBe('BLOCKED');
  });
});

describe('locale', () => {
  it('returns the Polish sentence for a Polish form', async () => {
    const { impl } = routedFetch({});
    const res: ProbeOutcome = await probeVenueUrl('facebook.com/teatr', {
      fetchImpl: impl, now: NOW, locale: 'pl',
    });
    expect(res.status === 'failure' && res.message).toMatch(/Facebooku/);
  });

  it('and the English one for an English form', async () => {
    const { impl } = routedFetch({});
    const res = await probeVenueUrl('facebook.com/teatr', { fetchImpl: impl, now: NOW, locale: 'en' });
    expect(res.status === 'failure' && res.message).toMatch(/Facebook or Instagram/);
  });

  it('refuses a social URL without making any request at all', async () => {
    const { impl, mock } = routedFetch({});
    await probeVenueUrl('https://instagram.com/teatr', { fetchImpl: impl, now: NOW });
    expect(mock).toHaveBeenCalledTimes(0);
  });
});
