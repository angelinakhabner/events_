import { describe, it, expect } from 'vitest';
import { fetchVenueHTML } from './fetcher.js';

describe('fetchVenueHTML', () => {
  it('returns body text on a 2xx response', async () => {
    const fakeFetch = (async () => new Response('<html>ok</html>', { status: 200 })) as typeof fetch;
    const html = await fetchVenueHTML('https://example/x', { fetcher: fakeFetch });
    expect(html).toBe('<html>ok</html>');
  });

  it('throws with HTTP status on a non-2xx response', async () => {
    const fakeFetch = (async () => new Response('boom', { status: 503 })) as typeof fetch;
    await expect(fetchVenueHTML('https://example/x', { fetcher: fakeFetch })).rejects.toThrow(/HTTP 503/);
  });

  it('surfaces the underlying cause.code on a node fetch failure', async () => {
    // Reproduce undici's "fetch failed" wrapper.
    const fakeFetch = (async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('getaddrinfo ENOTFOUND example.invalid'), { code: 'ENOTFOUND' }),
      });
    }) as typeof fetch;
    await expect(fetchVenueHTML('https://example.invalid/x', { fetcher: fakeFetch })).rejects.toThrow(
      /ENOTFOUND/,
    );
  });

  it('reports timeout when the underlying error is an AbortError wrapped as TypeError', async () => {
    // Node's fetch: TypeError('fetch failed', { cause: <... name AbortError> }).
    const fakeFetch = (async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }),
      });
    }) as typeof fetch;
    await expect(
      fetchVenueHTML('https://slow.example/x', { fetcher: fakeFetch, timeoutMs: 1234 }),
    ).rejects.toThrow(/timeout after 1234ms/);
  });

  it('sends browser-shaped headers (UA + Sec-Fetch-*) to clear WAF gates', async () => {
    let sent: Record<string, string> = {};
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      sent = init.headers as Record<string, string>;
      return new Response('<html/>', { status: 200 });
    }) as unknown as typeof fetch;
    await fetchVenueHTML('https://example/x', { fetcher: fakeFetch });
    expect(sent['User-Agent']).toMatch(/Chrome/);
    expect(sent['Sec-Fetch-Mode']).toBe('navigate');
    expect(sent['Sec-CH-UA']).toBeTruthy();
  });

  it('merges per-source header overrides over the defaults', async () => {
    let sent: Record<string, string> = {};
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      sent = init.headers as Record<string, string>;
      return new Response('<html/>', { status: 200 });
    }) as unknown as typeof fetch;
    await fetchVenueHTML('https://example/x', {
      fetcher: fakeFetch,
      headers: { Referer: 'https://example/', 'Accept-Language': 'de' },
    });
    expect(sent.Referer).toBe('https://example/');
    expect(sent['Accept-Language']).toBe('de'); // override wins
    expect(sent['User-Agent']).toMatch(/Chrome/); // defaults still present
  });

  it('adds an anti-bot hint on HTTP 403', async () => {
    const fakeFetch = (async () => new Response('nope', { status: 403 })) as typeof fetch;
    await expect(fetchVenueHTML('https://polin.example/x', { fetcher: fakeFetch })).rejects.toThrow(
      /HTTP 403.*anti-bot|WAF/i,
    );
  });

  it('adds a moved-URL hint on HTTP 404', async () => {
    const fakeFetch = (async () => new Response('gone', { status: 404 })) as typeof fetch;
    await expect(fetchVenueHTML('https://venue.example/old', { fetcher: fakeFetch })).rejects.toThrow(
      /HTTP 404.*moved|check the source/i,
    );
  });

  it('auto-retries without chain verification on a missing-intermediate cert error', async () => {
    let calls = 0;
    let secondInsecure = false;
    const fakeFetch = (async (_url: string, init: RequestInit & { dispatcher?: unknown }) => {
      calls += 1;
      if (calls === 1) {
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error('unable to verify the first certificate'), {
            code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
          }),
        });
      }
      secondInsecure = init.dispatcher != null;
      return new Response('<html>ok</html>', { status: 200 });
    }) as unknown as typeof fetch;
    const html = await fetchVenueHTML('https://artmuseum.example/x', { fetcher: fakeFetch });
    expect(html).toBe('<html>ok</html>');
    expect(calls).toBe(2);
    expect(secondInsecure).toBe(true); // retry used the insecure dispatcher
  });

  it('does NOT bypass other TLS failures (e.g. expired cert)', async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls += 1;
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' }),
      });
    }) as typeof fetch;
    await expect(fetchVenueHTML('https://expired.example/x', { fetcher: fakeFetch })).rejects.toThrow(
      /CERT_HAS_EXPIRED/,
    );
    expect(calls).toBe(1); // no insecure retry
  });

  it('uses the insecure dispatcher on the first attempt when insecureTLS is set', async () => {
    let firstInsecure = false;
    const fakeFetch = (async (_url: string, init: RequestInit & { dispatcher?: unknown }) => {
      firstInsecure = init.dispatcher != null;
      return new Response('<html/>', { status: 200 });
    }) as unknown as typeof fetch;
    await fetchVenueHTML('https://example/x', { fetcher: fakeFetch, insecureTLS: true });
    expect(firstInsecure).toBe(true);
  });
});
