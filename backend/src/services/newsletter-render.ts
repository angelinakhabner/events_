import type { Category, Event, Festival, NewsletterFrequency } from '@goin/shared';
import { env } from '../config.js';

/**
 * The daily/weekly brief, built to the "poster masthead" design (option 1b of
 * the newsletter handoff).
 *
 * Written as send-safe email markup rather than the page markup the design
 * reference was mocked in: nested `<table role="presentation">` instead of
 * flex/grid, every style inlined, no external stylesheet or webfont, and a
 * padded-`<td>` button rather than a styled `<a>` block. Mail clients — Outlook
 * above all, which renders through Word — support almost none of what the mock
 * relies on.
 *
 * Colours are flattened to hex for the same reason: the design expresses the
 * palette as `rgba()` over the page background, which Outlook does not
 * composite. Each constant below is that rgba pre-blended against the surface
 * it actually sits on.
 */

const TZ = 'Europe/Warsaw';
const WIDTH = 600;

/** Design tokens, flattened for email (see the note above). */
const C = {
  /** --color-bg, the card. */
  bg: '#faf8f0',
  /** Outside the 600px card. */
  page: '#eae7e7',
  /** --color-text / --color-accent. */
  ink: '#1a1712',
  /** Masthead text on ink. */
  onInk: '#f3f2f2',
  /** 85% / 90% of onInk over ink — the eyebrow and subcopy. */
  onInkEyebrow: '#d2d1d0',
  onInkSub: '#dddcdc',
  /** --color-divider (35% ink over bg), drawn as a 2px rule. */
  divider: '#aca9a2',
  /** --color-accent-100, the filled tag. */
  tagFill: '#f0ead0',
  /** 50% / 75% / 45% ink over bg — meta, description, footer. */
  meta: '#8d8b87',
  body: '#575552',
  footer: '#989691',
} as const;

/** Archivo is the design's face; email cannot load it, so the stack degrades
 *  to the metric-compatible grotesques every client already has. */
const FONT = "Archivo,'Helvetica Neue',Helvetica,Arial,sans-serif";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function fmt(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts }).format(new Date(iso));
}

const fmtTime = (iso: string) => fmt(iso, { hour: '2-digit', minute: '2-digit', hour12: false });
const fmtDay = (iso: string) => fmt(iso, { weekday: 'short', day: 'numeric', month: 'short' });
const fmtDayKey = (iso: string) => fmt(iso, { year: 'numeric', month: '2-digit', day: '2-digit' });

/** One-line descriptions only — the design gives each pick a single line. */
function oneLine(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).replace(/[\s,.;:—-]+$/, '')}…`;
}

/** Cinema picks get the filled tag, everything else the outline one. */
function tagCell(label: string, filled: boolean): string {
  const base =
    `font-family:${FONT};font-size:11px;line-height:1;letter-spacing:.02em;` +
    `text-transform:uppercase;color:${C.ink};padding:4px 10px;`;
  const style = filled
    ? `${base}background-color:${C.tagFill};`
    : `${base}border:1px solid ${C.ink};`;
  // A one-cell table, not a padded <span>: Word-engine Outlook drops padding
  // on inline elements, which would collapse the tag onto the text.
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">` +
    `<tr><td style="${style}">${escapeHtml(label.toUpperCase())}</td></tr></table>`
  );
}

/** Every pick is ruled underneath, and the first row in the list is ruled
 *  above too, so the list reads as a closed block — as in the design. */
function pickRow(event: Event, top: boolean): string {
  const border =
    (top ? `border-top:2px solid ${C.divider};` : '') + `border-bottom:2px solid ${C.divider};`;
  const venue = event.venue?.name ?? '';
  const description = event.description ? oneLine(event.description) : '';
  const link = event.sourceUrl
    ? `<a href="${escapeHtml(event.sourceUrl)}" style="color:${C.ink};text-decoration:none">${escapeHtml(event.title)}</a>`
    : escapeHtml(event.title);

  return (
    `<tr>` +
      // 76px time column + 18px gutter, matching the design's grid.
      `<td width="76" valign="top" style="${border}width:76px;padding:20px 18px 20px 0;` +
        `font-family:${FONT};font-weight:800;font-size:15px;line-height:1.2;color:${C.ink}">` +
        escapeHtml(fmtTime(event.startsAt)) +
      `</td>` +
      `<td valign="top" style="${border}padding:20px 0">` +
        tagCell(event.category, event.category === 'cinema') +
        `<div style="font-family:${FONT};font-weight:800;font-size:16px;line-height:1.25;color:${C.ink};margin:6px 0 4px">` +
          link +
        `</div>` +
        (venue
          ? `<div style="font-family:${FONT};font-size:11px;line-height:1.3;text-transform:uppercase;` +
            `letter-spacing:.06em;color:${C.meta};margin-bottom:6px">${escapeHtml(venue.toUpperCase())}</div>`
          : '') +
        (description
          ? `<div style="font-family:${FONT};font-size:13px;line-height:1.5;color:${C.body}">${escapeHtml(description)}</div>`
          : '') +
      `</td>` +
    `</tr>`
  );
}

/** Weekly briefs span days, so they get a day label between groups; a daily
 *  brief is one day by definition and the design shows no such label. */
function dayHeadingRow(iso: string, top: boolean): string {
  const border = top ? `border-top:2px solid ${C.divider};` : '';
  return (
    `<tr><td colspan="2" style="${border}padding:18px 0 0;` +
      `font-family:${FONT};font-weight:800;font-size:11px;line-height:1;text-transform:uppercase;` +
      `letter-spacing:.08em;color:${C.meta}">${escapeHtml(fmtDay(iso).toUpperCase())}</td></tr>`
  );
}

function picksTable(events: Event[], frequency: NewsletterFrequency): string {
  const sorted = [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const rows: string[] = [];
  let lastDay: string | null = null;

  for (const event of sorted) {
    // Only whatever lands first carries the rule that opens the list.
    const opensList = rows.length === 0;
    if (frequency === 'weekly') {
      const day = fmtDayKey(event.startsAt);
      if (day !== lastDay) {
        lastDay = day;
        rows.push(dayHeadingRow(event.startsAt, opensList));
        rows.push(pickRow(event, false));
        continue;
      }
    }
    rows.push(pickRow(event, opensList));
  }

  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="border-collapse:collapse">${rows.join('')}</table>`
  );
}

function mastheadRow(opts: {
  frequency: NewsletterFrequency;
  name: string | null;
  categories: string[];
  count: number;
  date: string;
}): string {
  const eyebrow = opts.frequency === 'daily' ? 'GOIN · DAILY' : 'GOIN · WEEKLY';
  const headline = opts.frequency === 'daily' ? 'Today in<br>Warsaw' : 'This week in<br>Warsaw';
  // Categories are user-authored tags, so they escape like any other input.
  const from = opts.categories.length
    ? ` from ${escapeHtml(listSentence(opts.categories))}`
    : ' from your venues';
  const picks = `${opts.count} pick${opts.count === 1 ? '' : 's'}${from}`;
  const sub = opts.name ? `Hi ${escapeHtml(opts.name)} — ${picks}` : picks;

  return (
    `<tr><td style="background-color:${C.ink};padding:36px 40px">` +
      `<div style="font-family:${FONT};font-weight:800;font-size:14px;line-height:1.2;` +
        `letter-spacing:.14em;text-transform:uppercase;color:${C.onInkEyebrow}">${escapeHtml(eyebrow)}</div>` +
      `<div style="font-family:${FONT};font-weight:800;font-size:34px;line-height:1.1;` +
        `color:${C.onInk};margin-top:14px">${headline}</div>` +
      `<div style="font-family:${FONT};font-size:14px;line-height:1.4;color:${C.onInkSub};margin-top:12px">` +
        `${sub} · ${escapeHtml(opts.date)}</div>` +
    `</td></tr>`
  );
}

/** "Cinema, Comedy & Museums" — the design's phrasing for the category list. */
export function listSentence(items: string[]): string {
  const clean = items.filter(Boolean);
  if (clean.length === 0) return '';
  if (clean.length === 1) return clean[0]!;
  return `${clean.slice(0, -1).join(', ')} & ${clean[clean.length - 1]}`;
}

// The rules below the picks run the full 600px, unlike the picks' own rules
// which are inset by the card's 40px gutter — so these rows carry their own
// padding rather than sitting inside a padded cell.
function festivalRow(festival: Festival): string {
  const through = fmt(`${festival.endDate}T12:00:00Z`, { day: 'numeric', month: 'short' });
  return (
    `<tr><td style="border-top:2px solid ${C.divider};padding:24px 40px;` +
      `font-family:${FONT};font-size:13px;line-height:1.6;color:${C.ink}">` +
      `<b>Also on:</b> ${escapeHtml(festival.name)} — ${escapeHtml(oneLine(festival.description, 90))} ` +
      `Through ${escapeHtml(through)}.</td></tr>`
  );
}

/** Padded-`<td>` button with a bgcolor attribute — the "bulletproof" shape.
 *  A styled `<a>` block, as in the mock, loses its fill in Outlook. */
function ctaRow(): string {
  const href = `${env.APP_URL}/my`;
  return (
    `<tr><td style="padding:24px 40px 40px">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
        `style="border-collapse:collapse">` +
        `<tr><td bgcolor="${C.ink}" style="background-color:${C.ink};padding:10px 14px">` +
          `<a href="${escapeHtml(href)}" style="font-family:${FONT};font-weight:800;font-size:14px;` +
            `line-height:1.4;color:${C.bg};text-decoration:none;display:block">See all events in Goin →</a>` +
        `</td></tr>` +
      `</table>` +
    `</td></tr>`
  );
}

function footerRow(categories: string[]): string {
  const manage = `${env.APP_URL}/my?tab=newsletter`;
  const reason = categories.length
    ? `Sent because you saved ${escapeHtml(listSentence(categories))} on Goin.`
    : 'Sent because you turned this brief on in Goin.';
  const link = `color:${C.footer};text-decoration:underline`;
  return (
    `<tr><td style="border-top:2px solid ${C.divider};padding:20px 40px 32px;text-align:center;` +
      `font-family:${FONT};font-size:11px;line-height:1.6;color:${C.footer}">` +
      `${reason}<br>` +
      `<a href="${escapeHtml(manage)}" style="${link}">Manage preferences</a> · ` +
      `<a href="${escapeHtml(manage)}" style="${link}">Unsubscribe</a>` +
    `</td></tr>`
  );
}

export interface BriefContent {
  events: Event[];
  frequency: NewsletterFrequency;
  /** Greeting name; null greets without one. */
  recipientName?: string | null;
  /** The reader's chosen tag categories, for the subcopy and footer reason. */
  categories?: string[];
  /** Ongoing festival for the "Also on" line, when there is one. */
  festival?: Festival | null;
  now?: Date;
}

/** Hidden preheader — the grey line clients show next to the subject. */
function preheader(text: string): string {
  return (
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;` +
    `font-size:1px;line-height:1px;color:${C.bg};opacity:0">${escapeHtml(text)}</div>`
  );
}

export function renderBriefHtml(content: BriefContent): string {
  const { events, frequency } = content;
  const now = content.now ?? new Date();
  const categories = content.categories ?? [];
  const date = fmtDay(now.toISOString());

  const body = events.length
    ? picksTable(events, frequency)
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
      `style="border-collapse:collapse"><tr><td style="border-top:2px solid ${C.divider};padding:24px 0;` +
      `font-family:${FONT};font-size:13px;line-height:1.5;color:${C.body}">Nothing on in this window.</td></tr></table>`;

  return (
    `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" ` +
      `"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">` +
    `<html xmlns="http://www.w3.org/1999/xhtml"><head>` +
      `<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />` +
      `<meta name="viewport" content="width=device-width, initial-scale=1" />` +
      `<meta name="color-scheme" content="light dark" />` +
      `<meta name="supported-color-schemes" content="light dark" />` +
      `<title>Goin</title>` +
    `</head>` +
    `<body style="margin:0;padding:0;background-color:${C.page};-webkit-text-size-adjust:100%">` +
      preheader(`${events.length} pick${events.length === 1 ? '' : 's'} in Warsaw · ${date}`) +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
        `style="border-collapse:collapse;background-color:${C.page}">` +
        `<tr><td align="center" style="padding:0">` +
          `<table role="presentation" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0" ` +
            `style="border-collapse:collapse;width:${WIDTH}px;max-width:${WIDTH}px;background-color:${C.bg}">` +
            mastheadRow({
              frequency,
              name: content.recipientName ?? null,
              categories,
              count: events.length,
              date,
            }) +
            // 8px below the list, matching the design's gap before the
            // full-width rule that opens the festival block.
            `<tr><td style="padding:8px 40px">${body}</td></tr>` +
            (content.festival ? festivalRow(content.festival) : '') +
            ctaRow() +
            footerRow(categories) +
          `</table>` +
        `</td></tr>` +
      `</table>` +
    `</body></html>`
  );
}

/** Categories are the tags the reader chose; when they chose none, fall back
 *  to the event categories actually present so the copy still says something
 *  true rather than naming tags nobody picked. */
export function briefCategories(eventTags: string[], events: Event[]): string[] {
  if (eventTags.length) return eventTags;
  const present = new Set<Category>();
  for (const e of events) present.add(e.category);
  return [...present].sort();
}
