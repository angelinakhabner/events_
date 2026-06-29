import * as cheerio from 'cheerio';
import type { Venue } from '@goin/shared';

export interface PreprocessResult {
  cleaned: string;
  /** Optional structured hint surfaced to the extractor (e.g. month/year label). */
  hint: string | null;
  usedFallback: boolean;
}

export function preprocessForVenue(html: string, venue: Pick<Venue, 'id'>): PreprocessResult {
  switch (venue.id) {
    case 'kino-muranow':
      return preprocessMuranow(html);
    default:
      return preprocessGeneric(html);
  }
}

function preprocessMuranow(html: string): PreprocessResult {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe, link').remove();

  const root = $('#calendar-wrapper').first();
  if (!root.length || root.text().trim().length === 0) {
    console.warn('[preprocessor] kino-muranow: #calendar-wrapper not found, falling back to full body');
    return preprocessGeneric(html);
  }

  // Strip the expanded details pane on each screening (keeps title link via cycles).
  // We retain the inner film URL by promoting it onto the outer .movie-calendar-info
  // before stripping the expand pane.
  root.find('.movie-calendar-info').each((_, el) => {
    const $el = $(el);
    const expand = $el.find('.movie-calendar-info-expand').first();
    if (expand.length) {
      const filmLink = expand.find('a.movie-calendar-info-expand__thumb').attr('href')
        || expand.find('a.c-button-tickets--movie-link').attr('href')
        || null;
      if (filmLink) {
        $el.attr('data-film-url', filmLink);
      }
      expand.remove();
    }
    $el.find('img').remove();
  });

  // Strip noisy attributes that don't help the model.
  root.find('*').each((_, el) => {
    if (el.type !== 'tag') return;
    for (const attr of Object.keys(el.attribs)) {
      if (attr.startsWith('data-drupal') || attr === 'data-once' || attr === 'data-toggle' || attr === 'data-parent' || attr === 'role' || attr === 'aria-hidden') {
        $(el).removeAttr(attr);
      }
    }
  });

  const monthLabel = root.find('.calendar-seance-full__month-label').first().text().trim();
  const cleaned = root.html() ?? '';
  return {
    cleaned,
    hint: monthLabel ? `Calendar month label: "${monthLabel}"` : null,
    usedFallback: false,
  };
}

function preprocessGeneric(html: string): PreprocessResult {
  // Pull out structured data BEFORE we strip <script> tags. JS-rendered venue
  // sites (the majority) don't put showtimes in static HTML — they ship them in
  // application/ld+json blocks or a __NEXT_DATA__ hydration payload that the
  // browser turns into the visible page. Stripping all scripts threw that away
  // and left the model a nav/footer shell, yielding 0 events. We surface the
  // structured JSON up front so the model prefers it.
  const structured = collectStructuredData(html);

  // Cost control: the HTML body is by far the largest part of what we send to
  // the model (tens of thousands of tokens), and we pay Anthropic per input
  // token on every extraction. When we have *trustworthy* structured data, the
  // body is redundant — the model already prefers the JSON — so we drop it
  // entirely and send only the structured payload. This is the single biggest
  // lever on per-scrape token cost.
  //
  // "Trustworthy" is deliberately conservative so we never trade away events:
  //   - JSON-LD with ≥2 event nodes — schema.org events carry startDate/name
  //     directly, and multiple nodes means the listing really is in the JSON.
  //   - __NEXT_DATA__ — these are SPA pages whose stripped <body> is an empty
  //     `<div id="__next">` shell anyway, so the body was never carrying events.
  // A lone JSON-LD event (often just the "featured" item) keeps the body as a
  // backup, matching the previous behaviour. If a venue ever regresses to fewer
  // events, loosen/tighten this check — it's the only thing gating the trim.
  if (structured && bodyIsRedundant(structured)) {
    const cleaned =
      `<!-- STRUCTURED DATA extracted from the page (this is the complete, authoritative event listing) -->\n` +
      `${structured.json}\n` +
      `<!-- END STRUCTURED DATA -->`;
    return { cleaned, hint: 'Structured event data (JSON) is the complete listing for this page.', usedFallback: true };
  }

  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe, link, head, nav, footer').remove();
  const body = $('body').html() ?? html;

  if (structured) {
    const cleaned =
      `<!-- STRUCTURED DATA extracted from the page (prefer this; it is the most reliable source) -->\n` +
      `${structured.json}\n` +
      `<!-- END STRUCTURED DATA. The HTML below is a fallback. -->\n${body}`;
    return { cleaned, hint: 'Structured event data (JSON) is included at the top of the input.', usedFallback: true };
  }

  return { cleaned: body, hint: null, usedFallback: true };
}

/** Whether the HTML body can be safely dropped given the structured data we
 *  found — see the rationale in preprocessGeneric. */
function bodyIsRedundant(s: StructuredData): boolean {
  if (s.source === 'nextdata') return true;
  return s.eventCount >= 2;
}

/** Matches schema.org event-ish @type values (Event, ScreeningEvent, …). */
const EVENT_TYPE_RE = /event/i;
/** Don't let a giant hydration payload blow the token budget. */
const MAX_STRUCTURED_CHARS = 60_000;

/** Structured event data pulled from a page, with enough metadata for the
 *  preprocessor to decide whether the HTML body is still needed. */
export interface StructuredData {
  /** Compact JSON string fed to the model. */
  json: string;
  /** Which source it came from — JSON-LD is per-event and reliable; the
   *  Next.js hydration blob is the whole app state. */
  source: 'jsonld' | 'nextdata';
  /** Number of event nodes for JSON-LD; 0 for the opaque __NEXT_DATA__ blob. */
  eventCount: number;
}

/**
 * Extract event-bearing structured data from raw HTML: schema.org JSON-LD
 * (filtered to Event-like types) and, as a fallback, the Next.js __NEXT_DATA__
 * hydration blob. Returns the payload plus its source/count, or null if nothing
 * useful is present.
 */
export function collectStructuredData(html: string): StructuredData | null {
  const $ = cheerio.load(html);

  const events: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    const parsed = safeJsonParse(raw);
    if (parsed === undefined) return;
    for (const node of flattenJsonLd(parsed)) {
      if (isEventNode(node)) events.push(node);
    }
  });

  if (events.length) {
    return { json: clamp(JSON.stringify(events), MAX_STRUCTURED_CHARS), source: 'jsonld', eventCount: events.length };
  }

  // No JSON-LD events — fall back to the Next.js hydration payload, which often
  // carries the listing as JSON even when nothing else does.
  const nextData = $('script#__NEXT_DATA__').first().contents().text().trim();
  if (nextData && safeJsonParse(nextData) !== undefined) {
    return { json: clamp(nextData, MAX_STRUCTURED_CHARS), source: 'nextdata', eventCount: 0 };
  }

  return null;
}

/**
 * Back-compat wrapper returning just the JSON string (or null). Prefer
 * {@link collectStructuredData} where the source/count matter.
 */
export function extractStructuredData(html: string): string | null {
  return collectStructuredData(html)?.json ?? null;
}

function flattenJsonLd(node: unknown): unknown[] {
  if (Array.isArray(node)) return node.flatMap(flattenJsonLd);
  if (node && typeof node === 'object') {
    const graph = (node as { '@graph'?: unknown })['@graph'];
    if (Array.isArray(graph)) return [node, ...graph.flatMap(flattenJsonLd)];
    return [node];
  }
  return [];
}

function isEventNode(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const type = (node as { '@type'?: unknown })['@type'];
  if (typeof type === 'string') return EVENT_TYPE_RE.test(type);
  if (Array.isArray(type)) return type.some((t) => typeof t === 'string' && EVENT_TYPE_RE.test(t));
  return false;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function clamp(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…[truncated]` : s;
}
