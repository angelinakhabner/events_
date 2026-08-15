import * as cheerio from 'cheerio';
import type { ProbeSampleEvent, SourceConfidence, SourceMethod } from '@afisz/shared';
import { parseJsonLdEvents } from '../scraper/jsonld.js';
import type { ProbeFetcher } from './fetch.js';

/**
 * The detector ladder (GOI-72 §3): cheapest and most exact first, the model
 * last. First hit wins, so a page carrying both JSON-LD and an RSS link
 * resolves to `jsonld` — the ordering here *is* the precedence rule.
 *
 * Every detector returns the same shape, and none of them writes anything.
 */

export interface DetectorHit {
  method: SourceMethod;
  confidence: SourceConfidence;
  /** Where the events were actually read from — often not the candidate page
   *  itself (an .ics feed, a wp-json endpoint). */
  sourceUrl: string;
  events: ProbeSampleEvent[];
}

export interface DetectorContext {
  /** The candidate page's URL, after redirects. */
  url: string;
  /** Its HTML. Detectors that need another document fetch it themselves. */
  html: string;
  fetcher: ProbeFetcher;
  now: Date;
}

/** How far ahead a probe looks. Wide on purpose: the question is "can this be
 *  scraped", not "what's on this week". */
export const PROBE_WINDOW_DAYS = 365;
/** Sample size shown back to the user (GOI-72 §7). */
export const MAX_SAMPLE_EVENTS = 5;

// ─── A. JSON-LD ──────────────────────────────────────────────────────────────

/**
 * schema.org Event nodes, by explicit type list rather than a `/event/i` match
 * on the type name. `Festival` carries no "event" in its name and would be
 * missed; `SubscriptionEvent`-shaped junk from a marketing tag would be caught.
 */
const EVENT_TYPES = new Set(
  [
    'Event',
    'ScreeningEvent',
    'TheaterEvent',
    'ExhibitionEvent',
    'ComedyEvent',
    'MusicEvent',
    'DanceEvent',
    'Festival',
    'SocialEvent',
    'VisualArtsEvent',
    'LiteraryEvent',
    'EducationEvent',
  ].map((t) => t.toLowerCase()),
);

export function detectJsonLd(ctx: DetectorContext): DetectorHit | null {
  const nodes = collectEventNodes(ctx.html);
  if (nodes.length === 0) return null;

  const rows = parseJsonLdEvents(nodes, {
    pageUrl: ctx.url,
    today: ctx.now,
    windowDays: PROBE_WINDOW_DAYS,
  });
  if (rows.length === 0) return null;

  return {
    method: 'jsonld',
    confidence: 'high',
    sourceUrl: ctx.url,
    events: rows.slice(0, MAX_SAMPLE_EVENTS).map((r) => ({ title: r.title, startsAt: r.starts_at })),
  };
}

/**
 * Every Event-typed node in the document, however it's nested: a bare object, a
 * top-level array, a `@graph`, or an `ItemList` whose `itemListElement` entries
 * are the events (which is how several Polish theatre CMSes emit a repertoire).
 */
export function collectEventNodes(html: string): unknown[] {
  const $ = cheerio.load(html);
  const out: unknown[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    for (const node of flatten(parsed)) {
      if (isEventNode(node)) out.push(node);
    }
  });

  return out;
}

function flatten(node: unknown, depth = 0): unknown[] {
  if (depth > 6) return [];
  if (Array.isArray(node)) return node.flatMap((n) => flatten(n, depth + 1));
  if (!node || typeof node !== 'object') return [];

  const obj = node as Record<string, unknown>;
  const nested: unknown[] = [];
  if (Array.isArray(obj['@graph'])) nested.push(...flatten(obj['@graph'], depth + 1));
  if (Array.isArray(obj.itemListElement)) nested.push(...flatten(obj.itemListElement, depth + 1));
  // ListItem wrappers hold the real node under `item`.
  if (obj.item && typeof obj.item === 'object') nested.push(...flatten(obj.item, depth + 1));

  return [obj, ...nested];
}

function isEventNode(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const type = (node as { '@type'?: unknown })['@type'];
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => typeof t === 'string' && EVENT_TYPES.has(t.trim().toLowerCase()));
}

// ─── B. iCal ─────────────────────────────────────────────────────────────────

export async function detectICal(ctx: DetectorContext): Promise<DetectorHit | null> {
  for (const url of icalCandidates(ctx)) {
    const res = await ctx.fetcher(url, { accept: 'text/calendar,text/plain;q=0.9,*/*;q=0.8' });
    if (res.ok === false) {
      if (res.code === 'PROBE_TIMEOUT') return null;
      continue;
    }
    // The only reliable test — plenty of hosts answer 200 text/html to a
    // guessed feed path.
    if (!res.body.trimStart().startsWith('BEGIN:VCALENDAR')) continue;

    const events = parseVEvents(res.body, ctx.now);
    if (events.length === 0) continue;
    return {
      method: 'ical',
      confidence: 'high',
      sourceUrl: res.url,
      events: events.slice(0, MAX_SAMPLE_EVENTS),
    };
  }
  return null;
}

function icalCandidates(ctx: DetectorContext): string[] {
  const out: string[] = [];
  const $ = cheerio.load(ctx.html);

  $('link[href], a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const type = ($(el).attr('type') ?? '').toLowerCase();
    if (!href.toLowerCase().includes('.ics') && !type.includes('text/calendar')) return;
    const abs = absolute(href, ctx.url);
    if (abs) out.push(abs);
  });

  const base = new URL(ctx.url);
  const withIcal = new URL(base);
  withIcal.searchParams.set('ical', '1');
  out.push(withIcal.toString());
  out.push(new URL('/events/feed/', base).toString());
  out.push(new URL('/?post_type=tribe_events&ical=1', base).toString());

  return dedupe(out).slice(0, 6);
}

/**
 * VEVENT blocks → sample events. Unfolds RFC 5545 continuation lines first
 * (a folded SUMMARY is otherwise truncated mid-title).
 *
 * `DTSTART;VALUE=DATE` is the exhibition case: a run of dates with no clock.
 * It keeps a null `startsAt` rather than being given a fake midnight, which is
 * the same distinction the events table already draws.
 */
export function parseVEvents(ics: string, now: Date): ProbeSampleEvent[] {
  const unfolded = ics.replace(/\r?\n[ \t]/g, '');
  const out: ProbeSampleEvent[] = [];
  const horizon = now.getTime() + PROBE_WINDOW_DAYS * 86_400_000;

  for (const block of unfolded.split(/BEGIN:VEVENT/i).slice(1)) {
    const body = block.split(/END:VEVENT/i)[0] ?? '';
    const summary = icalProp(body, 'SUMMARY');
    if (!summary) continue;

    const startRaw = icalLine(body, 'DTSTART');
    if (!startRaw) continue;
    const dateOnly = /;VALUE=DATE(?:[;:])/i.test(startRaw) || /^\d{8}$/.test(valueOf(startRaw));
    const parsed = parseIcalDate(valueOf(startRaw));
    if (!parsed) continue;

    const endRaw = icalLine(body, 'DTEND');
    const end = endRaw ? parseIcalDate(valueOf(endRaw)) : null;
    const stillRunning = end ? end.getTime() >= now.getTime() : false;
    if (parsed.getTime() > horizon) continue;
    if (parsed.getTime() < startOfDay(now).getTime() && !stillRunning) continue;

    out.push({ title: unescapeIcal(summary), startsAt: dateOnly ? null : parsed.toISOString() });
  }

  return out;
}

function icalLine(body: string, name: string): string | null {
  const re = new RegExp(`^${name}(;[^:\\r\\n]*)?:(.*)$`, 'im');
  const m = body.match(re);
  return m ? m[0] : null;
}

function icalProp(body: string, name: string): string | null {
  const line = icalLine(body, name);
  return line ? valueOf(line) || null : null;
}

function valueOf(line: string): string {
  const idx = line.indexOf(':');
  return idx === -1 ? '' : line.slice(idx + 1).trim();
}

/** `20260901T183000Z`, `20260901T183000` (floating) or `20260901` (date-only). */
function parseIcalDate(value: string): Date | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const date = new Date(
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0)),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function unescapeIcal(v: string): string {
  return v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').replace(/\s+/g, ' ').trim();
}

// ─── C. WordPress REST ───────────────────────────────────────────────────────

/**
 * The Events Calendar's REST endpoint, then plain posts.
 *
 * Worth probing even when the page itself looks dead: a WordPress site with a
 * broken calendar plugin on the frontend very often still answers on
 * `/wp-json/`, which is exactly the shape GOI-21 ran into.
 */
export async function detectWpRest(ctx: DetectorContext): Promise<DetectorHit | null> {
  const base = new URL(ctx.url);
  const today = ymd(ctx.now);

  const tribeUrl = new URL(
    `/wp-json/tribe/events/v1/events?per_page=20&start_date=${today}`,
    base,
  ).toString();
  const tribe = await ctx.fetcher(tribeUrl, { accept: 'application/json' });
  if (tribe.ok) {
    const events = parseTribeEvents(tribe.body);
    if (events.length > 0) {
      return {
        method: 'wp_rest',
        confidence: 'high',
        sourceUrl: tribe.url,
        events: events.slice(0, MAX_SAMPLE_EVENTS),
      };
    }
  }

  // Plain posts are blog entries. They're a *hint* that there's readable
  // content behind a dead frontend, not event data — so the JSON goes to the
  // extractor rather than being trusted field-by-field.
  const postsUrl = new URL('/wp-json/wp/v2/posts?per_page=20', base).toString();
  const posts = await ctx.fetcher(postsUrl, { accept: 'application/json' });
  if (posts.ok) {
    const titles = parseWpPostTitles(posts.body);
    if (titles.length > 0) {
      return {
        method: 'wp_rest_posts',
        confidence: 'low',
        sourceUrl: posts.url,
        events: titles.slice(0, MAX_SAMPLE_EVENTS).map((title) => ({ title, startsAt: null })),
      };
    }
  }

  return null;
}

function parseTribeEvents(body: string): ProbeSampleEvent[] {
  const json = safeJson(body);
  const list = (json as { events?: unknown })?.events;
  if (!Array.isArray(list)) return [];
  const out: ProbeSampleEvent[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    const title = decodeEntities(str(e.title));
    if (!title) continue;
    // Tribe emits both a local "start_date" and a UTC variant; prefer UTC.
    const raw = str(e.utc_start_date) ?? str(e.start_date);
    const parsed = raw ? new Date(raw.replace(' ', 'T') + (str(e.utc_start_date) ? 'Z' : '')) : null;
    out.push({
      title,
      startsAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
    });
  }
  return out;
}

function parseWpPostTitles(body: string): string[] {
  const json = safeJson(body);
  if (!Array.isArray(json)) return [];
  const out: string[] = [];
  for (const item of json) {
    if (!item || typeof item !== 'object') continue;
    const rendered = (item as { title?: { rendered?: unknown } }).title?.rendered;
    const title = decodeEntities(str(rendered));
    if (title) out.push(title);
  }
  return out;
}

// ─── D. RSS ──────────────────────────────────────────────────────────────────

/**
 * Titles and bodies from a feed. Confidence is only medium because a venue's
 * feed is as often news as programme — the items go to the extractor, and this
 * detector's job is finding them, not interpreting them.
 */
export async function detectRss(ctx: DetectorContext): Promise<DetectorHit | null> {
  for (const url of rssCandidates(ctx)) {
    const res = await ctx.fetcher(url, { accept: 'application/rss+xml,application/xml,text/xml' });
    if (res.ok === false) {
      if (res.code === 'PROBE_TIMEOUT') return null;
      continue;
    }
    const items = parseFeedItems(res.body);
    if (items.length === 0) continue;
    return {
      method: 'rss',
      confidence: 'medium',
      sourceUrl: res.url,
      events: items.slice(0, MAX_SAMPLE_EVENTS),
    };
  }
  return null;
}

function rssCandidates(ctx: DetectorContext): string[] {
  const $ = cheerio.load(ctx.html);
  const out: string[] = [];
  $('link[rel="alternate"]').each((_, el) => {
    const type = ($(el).attr('type') ?? '').toLowerCase();
    if (!type.includes('rss') && !type.includes('atom')) return;
    const abs = absolute($(el).attr('href') ?? '', ctx.url);
    if (abs) out.push(abs);
  });
  out.push(new URL('/feed/', new URL(ctx.url)).toString());
  return dedupe(out).slice(0, 4);
}

/** RSS `<item>` and Atom `<entry>`, parsed as XML rather than by regex so
 *  CDATA and nested markup survive. */
export function parseFeedItems(xml: string): ProbeSampleEvent[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const out: ProbeSampleEvent[] = [];

  $('item, entry').each((_, el) => {
    const node = $(el);
    const title = decodeEntities(node.find('title').first().text().trim());
    if (!title) return;
    const dateRaw =
      node.find('pubDate').first().text().trim() ||
      node.find('published').first().text().trim() ||
      node.find('updated').first().text().trim();
    const parsed = dateRaw ? new Date(dateRaw) : null;
    out.push({
      title,
      startsAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
    });
  });

  return out;
}

// ─── shared helpers ──────────────────────────────────────────────────────────

function absolute(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function dedupe(urls: string[]): string[] {
  return [...new Set(urls)];
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** WordPress renders titles with HTML entities (`&#8211;`, `&amp;`). */
function decodeEntities(v: string | null): string | null {
  if (!v) return null;
  return cheerio.load(`<x>${v}</x>`, { xmlMode: false })('x').text().replace(/\s+/g, ' ').trim() || null;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}
