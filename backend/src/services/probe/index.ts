import * as cheerio from 'cheerio';
import {
  PROBE_ERROR_SEVERITY,
  probeMessage,
  type ProbeErrorCode,
  type ProbeLocale,
  type ProbeOutcome,
  type ProbeProblem,
  type ProbeSampleEvent,
  type ProbeSuccess,
} from '@afisz/shared';
import { normalizeVenueUrl } from './normalize.js';
import { ProbeBudget, createProbeFetcher, type ProbeFetcher } from './fetch.js';
import { findCandidates } from './candidates.js';
import {
  MAX_SAMPLE_EVENTS,
  detectICal,
  detectJsonLd,
  detectRss,
  detectWpRest,
  type DetectorContext,
  type DetectorHit,
} from './detectors.js';
import { dateDensity, visibleText } from './heuristic.js';
import { diagnose } from './diagnose.js';
import { PAID_FETCH_TIMEOUT_MS, type PaidFetcher } from './paid.js';

/**
 * `venues.checkUrl` (GOI-72).
 *
 * Answers "whether and how can this venue be scraped", and when it can't, says
 * which of thirteen specific things went wrong. It writes nothing: the caller
 * decides what to do with the answer, and `venues.add` reads it from cache so
 * pressing ADD doesn't probe the site a second time.
 *
 * Ladder order is the cost order. Structured data is free and exact; the model
 * is neither; the paid browser is the most expensive thing we can do and is
 * never reached without the user saying so.
 */

/** Whole-ladder ceiling (GOI-72 §7). */
export const FREE_BUDGET_MS = 20_000;
export const PAID_BUDGET_MS = 60_000;

export interface ProbeOptions {
  locale?: ProbeLocale;
  /** Consent to spend a paid render. Only honoured after the free ladder has
   *  already concluded JS_RENDERED_NEEDS_PAID. */
  allowPaid?: boolean;
  now?: Date;
  /** Injected in tests; nothing here reaches the network without it. */
  fetchImpl?: typeof fetch;
  paidFetcher?: PaidFetcher | null;
  /** Runs page text through the LLM extractor. Injected so the cost guard can
   *  be asserted on: a page with no dates must never call this. */
  extract?: (input: { text: string; url: string; locale: ProbeLocale }) => Promise<ProbeSampleEvent[]>;
}

export async function probeVenueUrl(url: string, opts: ProbeOptions = {}): Promise<ProbeOutcome> {
  const locale = opts.locale ?? 'pl';
  const now = opts.now ?? new Date();

  const normalized = normalizeVenueUrl(url);
  if (!normalized.ok) return problem(normalized.code, locale, null);
  const normalizedUrl = normalized.url.toString();

  const budget = new ProbeBudget(opts.allowPaid ? PAID_BUDGET_MS : FREE_BUDGET_MS);
  const fetcher = createProbeFetcher(budget, opts.fetchImpl ?? fetch);

  // The pasted page, fetched once and reused: it seeds candidate discovery, it
  // is candidate #1, and its <head> supplies the name and language suggestions.
  const root = await fetcher(normalizedUrl, { requireHtml: true });
  if (!root.ok) return problem(root.code, locale, normalizedUrl);

  const meta = pageMeta(root.body);
  const candidates = await findCandidates(root.url, root.body, fetcher);

  let lastHtml = root.body;
  let lastContentType = root.contentType;
  let sawCandidate = false;

  for (const candidate of candidates) {
    if (budget.expired()) return problem('PROBE_TIMEOUT', locale, normalizedUrl);

    // Candidate #1 is the page we already have; the rest cost a request.
    let html = root.body;
    let contentType = root.contentType;
    let finalUrl = root.url;
    if (candidate !== root.url) {
      const res = await fetcher(candidate, { requireHtml: true });
      if (!res.ok) {
        if (res.code === 'PROBE_TIMEOUT') return problem('PROBE_TIMEOUT', locale, normalizedUrl);
        continue;
      }
      html = res.body;
      contentType = res.contentType;
      finalUrl = res.url;
    }
    sawCandidate = true;
    lastHtml = html;
    lastContentType = contentType;

    const ctx: DetectorContext = { url: finalUrl, html, fetcher, now };

    // A–D. First hit wins, so precedence is literally this order.
    const hit =
      detectJsonLd(ctx) ??
      (await detectICal(ctx)) ??
      (await detectWpRest(ctx)) ??
      (await detectRss(ctx));
    if (hit) return success(hit, normalizedUrl, meta);

    // E. The model, gated on the page actually containing dates.
    const text = visibleText(html);
    if (dateDensity(text, locale).pass && opts.extract) {
      const events = await opts.extract({ text, url: finalUrl, locale });
      if (events.length > 0) {
        return success(
          { method: 'llm_extract', confidence: 'medium', sourceUrl: finalUrl, events },
          normalizedUrl,
          meta,
        );
      }
    }
  }

  // Nothing on any candidate. F: work out why, from the last page we read.
  if (!sawCandidate) return problem('NO_LISTING_PAGE_FOUND', locale, normalizedUrl);

  const { code } = diagnose({ html: lastHtml, contentType: lastContentType, locale, now });

  if (code === 'JS_RENDERED_NEEDS_PAID') {
    if (!opts.allowPaid) return problem('JS_RENDERED_NEEDS_PAID', locale, normalizedUrl);
    return runPaid({ normalizedUrl, sourceUrl: root.url, locale, meta, opts, now });
  }

  return problem(code, locale, normalizedUrl);
}

/**
 * The paid path (GOI-72 §4). Reachable only with explicit consent *and* only
 * after the free ladder concluded the page needs a browser — both conditions,
 * every time.
 *
 * The rendered markdown goes through the same extractor as detector E. There is
 * deliberately no second extraction path: two of them is how the paid tier and
 * the free tier drift into disagreeing about the same page.
 */
async function runPaid(args: {
  normalizedUrl: string;
  sourceUrl: string;
  locale: ProbeLocale;
  meta: PageMeta;
  opts: ProbeOptions;
  now: Date;
}): Promise<ProbeOutcome> {
  const { opts, locale, normalizedUrl } = args;
  const paid = opts.paidFetcher;
  if (!paid) return problem('PAID_QUOTA_EXCEEDED', locale, normalizedUrl);
  if (!opts.extract) return problem('PAID_FETCH_FAILED', locale, normalizedUrl);

  let markdown: string;
  try {
    const res = await paid.fetchRendered(args.sourceUrl, { timeoutMs: PAID_FETCH_TIMEOUT_MS });
    markdown = res.markdown;
  } catch {
    return problem('PAID_FETCH_FAILED', locale, normalizedUrl);
  }

  const events = await opts.extract({ text: markdown, url: args.sourceUrl, locale });
  if (events.length === 0) return problem('NO_EVENTS_FOUND', locale, normalizedUrl);

  return success(
    { method: 'firecrawl', confidence: 'medium', sourceUrl: args.sourceUrl, events },
    normalizedUrl,
    args.meta,
  );
}

// ─── result shaping ──────────────────────────────────────────────────────────

function success(hit: DetectorHit, normalizedUrl: string, meta: PageMeta): ProbeSuccess {
  return {
    status: 'success',
    normalizedUrl,
    sourceUrl: hit.sourceUrl,
    method: hit.method,
    confidence: hit.confidence,
    suggestedName: meta.title,
    language: meta.language,
    sampleEvents: hit.events.slice(0, MAX_SAMPLE_EVENTS),
    shared: false,
  };
}

export function problem(
  code: ProbeErrorCode,
  locale: ProbeLocale,
  normalizedUrl: string | null,
): ProbeProblem {
  const severity = PROBE_ERROR_SEVERITY[code];
  return {
    status: severity === 'needs_decision' ? 'needs_decision' : 'failure',
    normalizedUrl,
    code,
    severity,
    message: probeMessage(code, locale),
  };
}

interface PageMeta {
  title: string | null;
  language: string | null;
}

/**
 * Name and language suggestions for the form. `og:site_name` is the venue's own
 * name; `<title>` usually carries a "Repertuar — Teatr X" suffix, so the site
 * name is stripped off the end when both are present.
 */
export function pageMeta(html: string): PageMeta {
  const $ = cheerio.load(html);
  const siteName = $('meta[property="og:site_name"]').attr('content')?.trim() || null;
  const rawTitle = $('title').first().text().trim() || null;

  let title = siteName ?? rawTitle;
  if (!siteName && rawTitle) {
    // "Repertuar | Teatr Studio" → "Repertuar"; a bare title is left alone.
    const parts = rawTitle.split(/\s+[|–—·]\s+/).filter(Boolean);
    if (parts.length > 1) title = parts[0]!.trim();
  }

  const lang = $('html').attr('lang')?.trim().toLowerCase().split('-')[0] ?? '';
  return {
    title: title ? title.slice(0, 120) : null,
    language: /^[a-z]{2,3}$/.test(lang) ? lang : null,
  };
}

export type { ProbeFetcher };
export { normalizeVenueUrl } from './normalize.js';
