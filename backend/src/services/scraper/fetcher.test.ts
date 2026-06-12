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
});
