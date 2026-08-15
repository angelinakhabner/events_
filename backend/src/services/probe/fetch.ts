import type { ProbeErrorCode } from '@afisz/shared';
import { isPublicHost } from './normalize.js';

/**
 * The probe's own HTTP layer (GOI-72 §7, §9).
 *
 * `fetchVenueHTML` is the scraper's fetcher: it returns a string and throws.
 * The probe has to *diagnose*, which means it needs the things that fetcher
 * throws away — the status code (403 is `BLOCKED`, not `UNREACHABLE`), the
 * content type (a PDF is `NOT_HTML`), and the URL we ended on after redirects
 * (that becomes the canonical `source_url` when `example.com` sends us to
 * `www.example.com`).
 *
 * Redirects are followed by hand for the same reason the SSRF guard exists at
 * all: `redirect: 'follow'` would happily walk a public host into
 * `http://169.254.169.254/`, and by then the request has already been made.
 */

export type ProbeFetchErrorCode = Extract<
  ProbeErrorCode,
  'UNREACHABLE' | 'BLOCKED' | 'NOT_HTML' | 'PROBE_TIMEOUT'
>;

export interface ProbeFetchOk {
  ok: true;
  /** URL after redirects — the canonical form of what we actually read. */
  url: string;
  status: number;
  contentType: string;
  body: string;
}

export interface ProbeFetchError {
  ok: false;
  code: ProbeFetchErrorCode;
  status: number | null;
}

export type ProbeFetchResult = ProbeFetchOk | ProbeFetchError;

export interface ProbeFetchOptions {
  /** Accept header — detectors ask for calendars and feeds, not just HTML. */
  accept?: string;
  /** Treat a non-HTML content type as NOT_HTML. Off for .ics/JSON/XML probes. */
  requireHtml?: boolean;
}

/** Every network call the probe makes goes through this shape, so tests can
 *  supply one function and be certain nothing escaped to the real internet. */
export type ProbeFetcher = (url: string, opts?: ProbeFetchOptions) => Promise<ProbeFetchResult>;

/** Per-request ceiling (GOI-72 §7). */
export const FETCH_TIMEOUT_MS = 8_000;
/** Bodies past this are truncated — a listing page that big is pathological
 *  and the detectors only ever read the head of the document anyway. */
const MAX_BODY_BYTES = 4_000_000;
const MAX_REDIRECTS = 5;
/** One hop to another origin (bare → www, http → https CDN). More than that
 *  is a URL shortener chain or a login wall, neither of which is a venue. */
const MAX_CROSS_ORIGIN_REDIRECTS = 1;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * A wall clock for the whole probe (GOI-72 §7: 20s free, 60s paid). Every
 * fetch is bounded by whichever is sooner — its own 8s or what's left of the
 * budget — so the ladder degrades to PROBE_TIMEOUT instead of hanging.
 */
export class ProbeBudget {
  private readonly deadline: number;

  constructor(totalMs: number, now: number = Date.now()) {
    this.deadline = now + totalMs;
  }

  remainingMs(now: number = Date.now()): number {
    return Math.max(0, this.deadline - now);
  }

  expired(now: number = Date.now()): boolean {
    return this.remainingMs(now) <= 0;
  }
}

export function createProbeFetcher(
  budget: ProbeBudget,
  impl: typeof fetch = fetch,
): ProbeFetcher {
  return async (url, opts = {}) => {
    const budgetMs = budget.remainingMs();
    if (budgetMs <= 0) return { ok: false, code: 'PROBE_TIMEOUT', status: null };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(FETCH_TIMEOUT_MS, budgetMs));

    try {
      let current = url;
      let crossOrigin = 0;

      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const res = await impl(current, {
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': USER_AGENT,
            From: 'hello@goin.app',
            Accept: opts.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'pl,en;q=0.8',
          },
        });

        if (isRedirect(res.status)) {
          const location = res.headers.get('location');
          if (!location) return { ok: false, code: 'UNREACHABLE', status: res.status };

          let next: URL;
          try {
            next = new URL(location, current);
          } catch {
            return { ok: false, code: 'UNREACHABLE', status: res.status };
          }
          // The guard has to be re-applied on every hop; a public host is free
          // to redirect us at the metadata service otherwise.
          if (
            (next.protocol !== 'http:' && next.protocol !== 'https:') ||
            !isPublicHost(next.hostname.toLowerCase())
          ) {
            return { ok: false, code: 'BLOCKED', status: res.status };
          }
          if (new URL(current).origin !== next.origin) {
            crossOrigin++;
            if (crossOrigin > MAX_CROSS_ORIGIN_REDIRECTS) {
              return { ok: false, code: 'BLOCKED', status: res.status };
            }
          }
          current = next.toString();
          continue;
        }

        // 401/403/429 mean the site works and is refusing us — a different
        // problem from a site that isn't there, and differently actionable.
        if (res.status === 401 || res.status === 403 || res.status === 429) {
          return { ok: false, code: 'BLOCKED', status: res.status };
        }
        if (!res.ok) return { ok: false, code: 'UNREACHABLE', status: res.status };

        const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
        if (opts.requireHtml && contentType && !isHtmlish(contentType)) {
          return { ok: false, code: 'NOT_HTML', status: res.status };
        }

        const body = (await res.text()).slice(0, MAX_BODY_BYTES);
        return { ok: true, url: current, status: res.status, contentType, body };
      }

      return { ok: false, code: 'UNREACHABLE', status: null };
    } catch (e) {
      if (isAbort(e)) return { ok: false, code: 'PROBE_TIMEOUT', status: null };
      return { ok: false, code: 'UNREACHABLE', status: null };
    } finally {
      clearTimeout(timer);
    }
  };
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isHtmlish(contentType: string): boolean {
  return contentType.includes('text/html') || contentType.includes('application/xhtml');
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
}
