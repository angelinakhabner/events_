import { Agent } from 'undici';

export interface FetchOptions {
  timeoutMs?: number;
  acceptLanguage?: string;
  fetcher?: typeof fetch;
  /** Per-source header overrides, merged over the browser defaults. */
  headers?: Record<string, string>;
  /**
   * Fetch even if the TLS chain can't be verified (e.g. a server that forgot to
   * send its intermediate cert). Off by default. Independent of this flag we
   * also auto-retry once on the specific chain-verification errors — see below.
   */
  insecureTLS?: boolean;
}

// A browser-like User-Agent. Many venue sites sit behind a WAF (Cloudflare etc.)
// that 403s obvious bot agents, which turns a scrapable page into a failed run.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CONTACT = 'hello@goin.app';

/**
 * Full browser-shaped header set. Modern WAFs increasingly gate on the presence
 * and shape of `Sec-Fetch-*` / client-hint headers, not just the User-Agent —
 * sending the same headers a real Chrome navigation would clears more 403s on
 * legitimate public pages. We still announce a contact via `From` for politeness.
 */
function defaultHeaders(acceptLanguage: string): Record<string, string> {
  return {
    'User-Agent': USER_AGENT,
    From: CONTACT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': acceptLanguage,
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Sec-CH-UA': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Windows"',
  };
}

// Dispatcher that skips TLS chain verification. Created once and reused. Only
// used as the cert-error fallback or when `insecureTLS` is set — never default.
let _insecureDispatcher: Agent | null = null;
function insecureDispatcher(): Agent {
  if (!_insecureDispatcher) {
    _insecureDispatcher = new Agent({ connect: { rejectUnauthorized: false } });
  }
  return _insecureDispatcher;
}

// OpenSSL chain-verification error codes. These mean the certificate itself is
// fine but the chain can't be built/verified locally — almost always a public
// server that simply omitted its intermediate cert (the MSN case). Distinct
// from an expired/wrong-host/revoked cert, which we do NOT auto-bypass.
const TLS_CHAIN_ERROR_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
]);

/** Marks an HTTP error response (non-2xx) so the outer layer can add a hint. */
class HttpStatusError extends Error {
  constructor(public readonly status: number, url: string) {
    super(`Failed to fetch ${url}: HTTP ${status}`);
    this.name = 'HttpStatusError';
  }
}

export async function fetchVenueHTML(url: string, opts: FetchOptions = {}): Promise<string> {
  const {
    timeoutMs = 15_000,
    acceptLanguage = 'pl,en;q=0.8',
    fetcher = fetch,
    headers = {},
    insecureTLS = false,
  } = opts;
  const mergedHeaders = { ...defaultHeaders(acceptLanguage), ...headers };

  const attempt = (insecure: boolean): Promise<string> =>
    doFetch(url, { fetcher, headers: mergedHeaders, timeoutMs, insecure });

  try {
    return await attempt(insecureTLS);
  } catch (e) {
    // Auto-retry once with chain verification relaxed, but ONLY for the
    // missing-intermediate class of errors. We read public HTML and send no
    // secrets, so for a legitimate-but-misconfigured server this is a pragmatic,
    // low-risk fallback rather than a blanket downgrade. Any other TLS failure
    // (expired, wrong host, revoked) still propagates.
    const code = tlsChainErrorCode(e);
    if (!insecureTLS && code) {
      console.warn(`[fetcher] ${url}: TLS chain unverifiable (${code}); retrying without chain verification`);
      try {
        return await attempt(true);
      } catch (retryErr) {
        throw rewrapFetchError(url, retryErr, timeoutMs);
      }
    }
    throw rewrapFetchError(url, e, timeoutMs);
  }
}

async function doFetch(
  url: string,
  args: { fetcher: typeof fetch; headers: Record<string, string>; timeoutMs: number; insecure: boolean },
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    // `dispatcher` is an undici extension to fetch's RequestInit (not in the DOM
    // lib types), so widen the type rather than cast to any.
    const init: RequestInit & { dispatcher?: Agent } = {
      headers: args.headers,
      signal: controller.signal,
    };
    if (args.insecure) init.dispatcher = insecureDispatcher();
    const res = await args.fetcher(url, init);
    if (!res.ok) throw new HttpStatusError(res.status, url);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** The OpenSSL chain-error code if this error is one we should retry, else null. */
function tlsChainErrorCode(e: unknown): string | null {
  if (!(e instanceof Error)) return null;
  const codes = [
    (e as { code?: string }).code,
    ((e.cause ?? null) as { code?: string } | null)?.code,
  ];
  return codes.find((c) => c && TLS_CHAIN_ERROR_CODES.has(c)) ?? null;
}

/**
 * Turn the raw fetch failure into a debuggable, actionable message. Node's
 * undici fetch throws a generic "fetch failed" and tucks the real reason into
 * `cause`; HTTP errors arrive as HttpStatusError with a status we annotate.
 */
function rewrapFetchError(url: string, e: unknown, timeoutMs: number): Error {
  if (e instanceof HttpStatusError) {
    if (e.status === 403) {
      return new Error(`${e.message} (blocked — likely an anti-bot/WAF challenge; the page may require JS rendering)`);
    }
    if (e.status === 404) {
      return new Error(`${e.message} (not found — the listing URL may have moved; check the source's URL)`);
    }
    return e;
  }
  if (e instanceof Error) {
    const cause = (e.cause ?? null) as { name?: string; code?: string; message?: string } | null;
    // Node wraps abort as TypeError('fetch failed', { cause: DOMException 'AbortError' }),
    // so check both the outer error and its cause for the abort signature.
    if (e.name === 'AbortError' || cause?.name === 'AbortError' || /aborted/i.test(e.message)) {
      return new Error(`Failed to fetch ${url}: timeout after ${timeoutMs}ms`);
    }
    if (cause) {
      return new Error(`Failed to fetch ${url}: ${e.message} (${cause.code ?? ''} ${cause.message ?? ''})`.trim());
    }
  }
  return e instanceof Error ? e : new Error(String(e));
}
