export interface FetchOptions {
  timeoutMs?: number;
  acceptLanguage?: string;
  fetcher?: typeof fetch;
}

const USER_AGENT = 'Goin scraper / contact: hello@goin.app';

export async function fetchVenueHTML(url: string, opts: FetchOptions = {}): Promise<string> {
  const { timeoutMs = 15_000, acceptLanguage = 'pl,en;q=0.8', fetcher = fetch } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': acceptLanguage,
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
    }
    return await res.text();
  } catch (e) {
    // Node's undici fetch throws a generic "fetch failed" and tucks the real
    // reason (ECONNRESET, ENOTFOUND, certificate, AbortError, ...) into the
    // `cause` chain. Surface it so deploy logs are debuggable.
    if (e instanceof Error && (e.name === 'AbortError' || /aborted/i.test(e.message))) {
      throw new Error(`Failed to fetch ${url}: timeout after ${timeoutMs}ms`);
    }
    if (e instanceof Error && 'cause' in e && e.cause) {
      const cause = e.cause as { code?: string; message?: string };
      throw new Error(`Failed to fetch ${url}: ${e.message} (${cause.code ?? ''} ${cause.message ?? ''})`.trim());
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
