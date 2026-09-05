import { isExhibition } from '@afisz/shared';
import type {
  Event, Festival, NewsletterDetail, NewsletterFrequency,
} from '@afisz/shared';
import type { QueuedChange, QueuedEvent, WantToGoSection } from './want-to-go-queue.js';
import { env } from '../config.js';
import {
  PL, closingDate, dateRange, festivalSpan, longDate, runSpan, shortDate, time, weekday,
} from './newsletter-copy.js';

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
  /** The app's red, for the one line in a brief that is urgent (GOI-101). */
  accent: '#c62828',
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

/** Only the grouping key now — every reader-facing date comes from
 *  `newsletter-copy.ts`, which formats in Polish (GOI-110). */
function fmt(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts }).format(new Date(iso));
}

const fmtDayKey = (iso: string) => fmt(iso, { year: 'numeric', month: '2-digit', day: '2-digit' });

/** One-line descriptions only — the design gives each pick a single line. */
function oneLine(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).replace(/[\s,.;:—-]+$/, '')}…`;
}

/** One venue's showings of a title on a given day. */
export interface ShowingVenue {
  name: string;
  /** ISO starts, ascending. */
  startsAt: string[];
}

/**
 * A title on one day, however many times and wherever it is on (GOI-36).
 *
 * A film playing three cinemas on Saturday used to occupy three cards, which
 * pushed everything else out of a brief that only shows a handful of picks and
 * read as if the newsletter were repeating itself.
 */
export interface Pick {
  /** The event that supplies the title, category, link and description —
   *  always the earliest, so the card links to the first showing. */
  lead: Event;
  /** Earliest start across every showing; the list sorts on this. */
  startsAt: string;
  venues: ShowingVenue[];
  /** Total showings across all venues — 1 for an ordinary pick. */
  count: number;
}

/**
 * Collapse events into one Pick per title per Warsaw day.
 *
 * Grouped on the day *in Warsaw*, not the UTC date: a 00:30 show belongs to
 * the evening a reader would call it, and a UTC key would split a single
 * evening across two cards. Titles match case-insensitively and ignore
 * surrounding whitespace, since they come from different venues' markup.
 */
export function groupPicks(events: Event[]): Pick[] {
  const byKey = new Map<string, Event[]>();
  for (const e of events) {
    const key = `${fmtDayKey(e.startsAt)}|${e.title.trim().toLowerCase()}`;
    const list = byKey.get(key);
    if (list) list.push(e);
    else byKey.set(key, [e]);
  }

  const picks: Pick[] = [];
  for (const group of byKey.values()) {
    const sorted = [...group].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const lead = sorted[0]!;

    // Venues in the order their first showing runs, so the card reads
    // chronologically rather than alphabetically.
    const byVenue = new Map<string, ShowingVenue>();
    for (const e of sorted) {
      const name = e.venue?.name ?? '';
      const existing = byVenue.get(name);
      if (existing) existing.startsAt.push(e.startsAt);
      else byVenue.set(name, { name, startsAt: [e.startsAt] });
    }

    picks.push({
      // A later showing may carry the description the earliest one lacks —
      // enrichment is per-page, so coverage is uneven across venues.
      lead: sorted.find((e) => e.description)
        ? { ...lead, description: sorted.find((e) => e.description)!.description }
        : lead,
      startsAt: lead.startsAt,
      venues: [...byVenue.values()],
      count: sorted.length,
    });
  }

  // Earliest first, with the same tie-break the section itself uses, so two
  // films at one time cannot swap places between the email and the PDF
  // (GOI-121).
  return picks.sort(
    (a, b) => a.startsAt.localeCompare(b.startsAt) || a.lead.title.localeCompare(b.lead.title),
  );
}

/**
 * One line per venue, each carrying that venue's own times (GOI-110).
 *
 * They used to be joined into a single run-on string — "MURANÓW 17:30, 20:15 ·
 * KINOTEKA 19:00" — which reads as one place with four showings until you
 * parse it. Two cinemas showing the same film are two places you could go, and
 * the design sets them as two lines.
 */
function venueLines(pick: Pick): string[] {
  return pick.venues.map((v) => {
    const times = v.startsAt.map(time).join(', ');
    return v.name ? `${v.name} \u00b7 ${times}` : times;
  });
}

/** Every pick is ruled underneath, and the first row in the list is ruled
 *  above too, so the list reads as a closed block — as in the design. */
function pickRow(
  pick: Pick, top: boolean, detail: NewsletterDetail, windowDays: number,
  /** Date the row "5 SIERPNIA, SOBOTA" rather than "SB 5 VIII" (GOI-122).
   *  The time still leads it, in the gutter, since that is what a museum
   *  event asks a reader to be somewhere for. */
  longForm = false,
): string {
  // An exhibition has no showtime worth putting in a gutter — it is on all day
  // for months — so it is dated by when it closes instead (GOI-67, GOI-110).
  if (isExhibition(pick.lead)) return exhibitionRow(pick, top, detail);

  const event = pick.lead;
  const border =
    (top ? `border-top:2px solid ${C.divider};` : '') + `border-bottom:2px solid ${C.divider};`;
  const description = blurb(event, detail);
  // A section spanning more than a day dates each row; a single-day one would
  // only be repeating its own masthead. This replaces the day-heading rows the
  // list used to be broken up by — the design dates the row, not the group.
  const dated = windowDays > 1
    ? `<div style="font-family:${FONT};font-weight:800;font-size:10px;line-height:1.2;` +
      `letter-spacing:.14em;text-transform:uppercase;color:${C.meta};margin-bottom:4px">` +
      `${escapeHtml(longForm ? longDate(pick.startsAt) : shortDate(pick.startsAt))}</div>`
    : '';

  return (
    `<tr>` +
      // 76px time column + 18px gutter, matching the design's grid.
      `<td width="76" valign="top" style="${border}width:76px;padding:20px 18px 20px 0;` +
        `font-family:${FONT};font-weight:800;font-size:15px;line-height:1.2;color:${C.accent}">` +
        escapeHtml(time(pick.startsAt)) +
      `</td>` +
      `<td valign="top" style="${border}padding:20px 0">` +
        dated +
        `<div style="font-family:${FONT};font-weight:800;font-size:16px;line-height:1.25;color:${C.ink}">` +
          titleLink(event) +
        `</div>` +
        venueLines(pick).map((line) =>
          `<div style="font-family:${FONT};font-weight:700;font-size:11px;line-height:1.35;` +
          `text-transform:uppercase;letter-spacing:.06em;color:${C.body};margin-top:3px">` +
          `${escapeHtml(line.toUpperCase())}</div>`).join('') +
        (description
          ? `<div style="font-family:${FONT};font-size:13px;line-height:1.5;color:${C.body};` +
            `margin-top:6px">${escapeHtml(description)}</div>`
          : '') +
      `</td>` +
    `</tr>`
  );
}

/**
 * An exhibition: dated by its closing, across the full width.
 *
 * The email said nothing about when a run ends — it printed the opening time
 * in the gutter like a screening, which for something on until October is the
 * one fact about it that does not matter. The PDF has dated these by their
 * closing since it was redrawn; this is the email catching up (GOI-110).
 */
function exhibitionRow(pick: Pick, top: boolean, detail: NewsletterDetail): string {
  const event = pick.lead;
  const border =
    (top ? `border-top:2px solid ${C.divider};` : '') + `border-bottom:2px solid ${C.divider};`;
  const description = blurb(event, detail);
  // From when till when, not only till when (GOI-122). A reader deciding
  // whether to go this month wants both ends of the run; "DO 14 WRZEŚNIA" on
  // its own says nothing about whether it has opened.
  const eyebrow = [
    runSpan(event.startsAt, event.endsAt ?? null),
    pick.venues[0]?.name.toUpperCase(),
  ].filter(Boolean).join(' \u00b7 ');

  return (
    `<tr><td colspan="2" valign="top" style="${border}padding:20px 0">` +
      (eyebrow
        ? `<div style="font-family:${FONT};font-weight:800;font-size:10px;line-height:1.2;` +
          `letter-spacing:.14em;text-transform:uppercase;color:${C.accent};margin-bottom:5px">` +
          `${escapeHtml(eyebrow)}</div>`
        : '') +
      `<div style="font-family:${FONT};font-weight:800;font-size:16px;line-height:1.25;color:${C.ink}">` +
        titleLink(event) +
      `</div>` +
      (description
        ? `<div style="font-family:${FONT};font-size:13px;line-height:1.5;color:${C.body};` +
          `margin-top:6px">${escapeHtml(description)}</div>`
        : '') +
    `</td></tr>`
  );
}

/** The title, linked to the venue's own page where there is one. */
function titleLink(event: Event): string {
  return event.sourceUrl
    ? `<a href="${escapeHtml(event.sourceUrl)}" style="color:${C.ink};text-decoration:none">` +
      `${escapeHtml(event.title)}</a>`
    : escapeHtml(event.title);
}

/** "Full" keeps the whole blurb; "short" trims it to the design's one line. */
function blurb(event: Event, detail: NewsletterDetail): string {
  if (!event.description || detail === 'line') return '';
  return detail === 'full' ? oneLine(event.description, 600) : oneLine(event.description);
}

/**
 * The saved-events block (GOI-101), at the top of the issue.
 *
 * Above every category section, and deliberately: it is the only part of a
 * brief that asks the reader to do something, and burying it under three
 * listings of what is on would make it a footnote to the news.
 *
 * Grouped by state under its own subheading rather than listed flat (GOI-110):
 * the states are not degrees of the same thing — "this was cancelled", "this
 * is your last chance" and "this is tomorrow" are three different requests,
 * and a reader scanning for the urgent one should not have to read the times.
 * Changes lead: something that happened outranks something that is coming.
 */
/** The short marker in a reminder row's gutter. */
function queueGutter(item: QueuedEvent): string {
  if (item.state === 'ongoing') return PL.now;
  return item.state === 'tomorrow' ? time(item.event.startsAt) : weekday(item.event.startsAt);
}

/** The line under a reminder's title: where it is, and the date that matters
 *  for its state — the showtime, or for a run, when it closes. */
function queueMeta(item: QueuedEvent): string {
  const when = item.state === 'ongoing'
    ? (item.event.endsAt ? closingDate(item.event.endsAt) : null)
    : (item.state === 'tomorrow' ? null : time(item.event.startsAt));
  return [item.event.venue?.name, when].filter(Boolean).join(' \u00b7 ');
}

function wantToGoBlock(section: WantToGoSection): string {
  if (section.reminders.length === 0 && section.changes.length === 0) return '';

  const rows: string[] = [blockTitleRow(PL.wantToGo)];

  if (section.changes.length > 0) {
    rows.push(subHeadingRow(PL.changes, true));
    for (const change of section.changes) {
      rows.push(queueRow({
        // No "ZMIANA" marker: the subheading directly above already says
        // these are changes, and repeating it in the gutter of every row
        // spent the one column that could say something the reader does not
        // already know. The day the affected event falls on is that.
        gutter: weekday(change.event.startsAt),
        title: change.event.title,
        meta: [change.event.venue?.name, changeNote(change)].filter(Boolean).join(' \u00b7 '),
      }));
    }
  }

  // `ongoing` last: the three above are deadlines, and a run that is simply
  // open is the one row nobody has to act on today.
  for (const [state, label, urgent] of [
    ['last_chance', PL.lastChance, true],
    ['tomorrow', PL.tomorrow, false],
    ['this_week', PL.thisWeek, false],
    ['ongoing', PL.ongoing, false],
  ] as const) {
    const items = section.reminders.filter((r) => r.state === state);
    if (items.length === 0) continue;
    rows.push(subHeadingRow(label, urgent));
    for (const item of items) {
      rows.push(queueRow({
        // A reminder for tomorrow is about a time; one for later in the week
        // is about a day; an exhibition already open is about neither, and its
        // opening weekday is weeks behind.
        gutter: queueGutter(item),
        title: item.event.title,
        meta: queueMeta(item),
      }));
    }
  }

  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
      `style="border-collapse:collapse;margin-bottom:8px">${rows.join('')}</table>`
  );
}

/** A block title, over the heavy rule that opens what it names. */
function blockTitleRow(label: string): string {
  return (
    `<tr><td colspan="2" style="padding:14px 0 6px;font-family:${FONT};font-weight:800;` +
      `font-size:13px;line-height:1.2;letter-spacing:.16em;text-transform:uppercase;` +
      `color:${C.ink}">${escapeHtml(label.toUpperCase())}</td></tr>` +
    `<tr><td colspan="2" style="border-top:2px solid ${C.ink};font-size:0;line-height:0;` +
      `padding:0">&nbsp;</td></tr>`
  );
}

/**
 * A state's subheading inside the queue.
 *
 * Red for the two that are about something going wrong or running out, ink
 * for the two that are only telling you when — the design's own split, and
 * the reason the block is grouped at all: a reader scanning for the urgent
 * one should be able to find it by colour rather than by reading.
 */
function subHeadingRow(label: string, urgent: boolean): string {
  return (
    `<tr><td colspan="2" style="padding:16px 0 4px;font-family:${FONT};font-weight:800;` +
      `font-size:10px;line-height:1.2;letter-spacing:.18em;text-transform:uppercase;` +
      `color:${urgent ? C.accent : C.ink}">${escapeHtml(label.toUpperCase())}</td></tr>`
  );
}

/** A queue row: a short marker in the gutter, title and meta beside it. */
function queueRow(args: { gutter: string; title: string; meta: string }): string {
  const border = `border-top:1px solid ${C.divider};`;
  return (
    `<tr>` +
      `<td width="76" valign="top" style="${border}width:76px;padding:12px 18px 12px 0;` +
        `font-family:${FONT};font-weight:800;font-size:10px;line-height:1.3;letter-spacing:.08em;` +
        `text-transform:uppercase;color:${C.accent}">${escapeHtml(args.gutter.toUpperCase())}</td>` +
      `<td valign="top" style="${border}padding:12px 0">` +
        `<div style="font-family:${FONT};font-weight:800;font-size:15px;line-height:1.25;` +
          `color:${C.ink}">${escapeHtml(args.title)}</div>` +
        (args.meta
          ? `<div style="font-family:${FONT};font-weight:700;font-size:11px;line-height:1.3;` +
            `letter-spacing:.06em;text-transform:uppercase;color:${C.body};margin-top:3px">` +
            `${escapeHtml(args.meta.toUpperCase())}</div>`
          : '') +
      `</td>` +
    `</tr>`
  );
}

/** What a change is, in a phrase that fits beside the venue. */
function changeNote(change: QueuedChange): string {
  if (change.type === 'rescheduled') {
    return change.newValue ? PL.rescheduled(time(change.newValue)) : PL.movedVenue;
  }
  if (change.type === 'cancelled') return PL.cancelled;
  if (change.type === 'moved') return PL.movedVenue;
  return PL.soldOut;
}

/** A category's heading, set over the rule that opens its list. */
function sectionHeadingRow(section: BriefSection, top: boolean): string {
  const border = top ? `border-top:2px solid ${C.divider};` : '';
  return (
    `<tr><td colspan="2" style="${border}padding:22px 0 6px;` +
      `font-family:${FONT};font-weight:800;font-size:13px;line-height:1.2;` +
      `letter-spacing:.16em;text-transform:uppercase;color:${C.ink}">` +
      `${escapeHtml(sectionLabel(section.category).toUpperCase())}</td></tr>` +
    `<tr><td colspan="2" style="border-top:2px solid ${C.ink};font-size:0;line-height:0;` +
      `padding:0">&nbsp;</td></tr>`
  );
}

/**
 * What a category is called in the brief.
 *
 * The built-ins get their Polish names, matching everything else in the issue
 * (GOI-110). A reader's own tag is their word for it and is printed as they
 * typed it — translating someone's "arthouse" would be inventing a name for
 * something they already named.
 */
export function sectionLabel(category: string): string {
  return PL.categories[category as keyof typeof PL.categories] ?? category;
}

/** A run of picks under one optional subheading. */
interface PickGroup {
  label: string | null;
  picks: Pick[];
}

/**
 * The museums section, in its two halves (GOI-122).
 *
 * "Museums" is one word for two different things: a run you can drop in on any
 * afternoon for the next six weeks, and a talk at seven on Thursday. Listed
 * together they read as one undifferentiated schedule, and the reader has to
 * check each row's date line to work out which kind of plan it is.
 *
 * Only where both halves are actually present — a section of nothing but runs
 * gets no "Wystawy" heading, which would only repeat the section's own — and
 * only for exhibitions: every other category is one shape already.
 */
export function splitByShape(section: BriefSection, picks: Pick[]): PickGroup[] {
  if (section.category !== 'exhibition') return [{ label: null, picks }];
  const runs = picks.filter((p) => isExhibition(p.lead));
  const timed = picks.filter((p) => !isExhibition(p.lead));
  if (runs.length === 0 || timed.length === 0) return [{ label: null, picks }];
  // Runs first: they are the answer to "what is on at the museum", and the
  // events are what is on *besides*.
  return [
    { label: PL.exhibitions, picks: runs },
    { label: PL.events, picks: timed },
  ];
}

function picksTable(sections: BriefSection[]): string {
  const rows: string[] = [];
  const named = sections.length > 1 || (sections[0]?.category ?? '') !== '';

  for (const section of sections) {
    // One card per title per day, however many venues and times it runs at
    // (GOI-36). Already sorted by first showing.
    const picks = groupPicks(section.events);

    if (named && section.category) {
      rows.push(sectionHeadingRow(section, rows.length === 0));
    }
    for (const group of splitByShape(section, picks)) {
      if (group.label) rows.push(subHeadingRow(group.label, false));
      for (const pick of group.picks) {
        // Only whatever lands first carries the rule that opens the list.
        rows.push(pickRow(
          pick, rows.length === 0, section.detail, section.windowDays,
          section.category === 'exhibition',
        ));
      }
    }
  }

  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="border-collapse:collapse">${rows.join('')}</table>`
  );
}

function mastheadRow(opts: { now: Date; days: number }): string {
  return (
    `<tr><td style="padding:24px 40px 0">` +
      // The band is inset by the card gutter rather than bled to its edge —
      // as in the design, and because a full-bleed dark block is the first
      // thing a client's dark-mode filter inverts.
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
        `style="border-collapse:collapse;background-color:${C.ink}">` +
      `<tr><td style="padding:26px 26px 24px">` +
      `<div style="font-family:${FONT};font-weight:800;font-size:26px;line-height:1.1;` +
        `letter-spacing:.5px;color:${C.onInk}">${PL.wordmark}` +
        // The square is the design's mark beside the wordmark. A styled span
        // rather than an image: an email that blocks images still shows it.
        `<span style="display:inline-block;width:9px;height:9px;margin-left:10px;` +
          `background-color:${C.accent}">&nbsp;</span>` +
      `</div>` +
      `<div style="font-family:${FONT};font-weight:800;font-size:11px;line-height:1.2;` +
        `letter-spacing:.2em;color:${C.accent};margin-top:16px">` +
        `${escapeHtml(dateRange(opts.now, opts.days))}</div>` +
      `<div style="font-family:${FONT};font-weight:800;font-size:30px;line-height:1.1;` +
        `letter-spacing:1px;color:${C.onInk};margin-top:6px">${PL.city}</div>` +
      `</td></tr></table>` +
    `</td></tr>`
  );
}

/**
 * One line of arithmetic under the band: how much is here, from where.
 *
 * Closed by the heavy rule that the section headings also sit on, so the
 * header reads as one block rather than as a stray sentence.
 */
function summaryRow(opts: { picks: number; venues: number; name: string | null }): string {
  const count = PL.summary(opts.picks, opts.venues);
  const line = opts.name ? PL.addressed(opts.name, count) : count;
  return (
    `<tr><td style="padding:20px 40px 0">` +
      `<div style="font-family:${FONT};font-size:14px;line-height:1.5;color:${C.body}">` +
        `${escapeHtml(line)}</div>` +
      `<div style="border-top:2px solid ${C.ink};font-size:0;line-height:0;margin-top:16px">&nbsp;</div>` +
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
/**
 * The black band of what is running across the city (GOI-110).
 *
 * It used to be one grey "Also on:" sentence at the very foot of the issue,
 * under the listings and the button — which is where you put something a
 * reader may eventually scroll to, not something that changes what they are
 * reading. A festival does change it, so it sits under the saved-events queue
 * and above every listing, in the same band the masthead uses.
 */
function festivalsRow(festivals: Festival[]): string {
  if (festivals.length === 0) return '';
  const items = festivals.map((f) =>
    `<tr><td style="padding:6px 0 0">` +
      `<span style="font-family:${FONT};font-weight:800;font-size:15px;line-height:1.3;` +
        `color:${C.onInk}">${escapeHtml(f.name)}</span>` +
      `<span style="font-family:${FONT};font-weight:800;font-size:10px;line-height:1.3;` +
        `letter-spacing:.12em;color:${C.onInkEyebrow}">&nbsp;&nbsp;` +
        `${escapeHtml(festivalSpan(f))}</span>` +
    `</td></tr>`).join('');

  return (
    `<tr><td style="padding:14px 40px 0">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
        `style="border-collapse:collapse;background-color:${C.ink}">` +
      `<tr><td style="padding:18px 26px 20px">` +
      `<div style="font-family:${FONT};font-weight:800;font-size:10px;line-height:1.2;` +
        `letter-spacing:.18em;text-transform:uppercase;color:${C.accent}">` +
        `${escapeHtml(PL.festivals.toUpperCase())}</div>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
        `style="border-collapse:collapse">${items}</table>` +
      `</td></tr></table>` +
    `</td></tr>`
  );
}

/**
 * The footer: the three things a reader might want from a brief they have
 * finished reading. Replaces the "See all events" button as well — the design
 * carries "open in AFISZ" as one of these links, and a full-width button
 * saying the same thing directly above them was the same offer twice.
 */
function footerRow(): string {
  const manage = `${env.APP_URL}/my?tab=newsletter`;
  const open = `${env.APP_URL}/my`;
  const link = `color:${C.footer};text-decoration:underline`;
  return (
    `<tr><td style="padding:26px 40px 0"><div style="border-top:2px solid ${C.ink};` +
      `font-size:0;line-height:0">&nbsp;</div></td></tr>` +
    `<tr><td style="padding:14px 40px 34px;` +
      `font-family:${FONT};font-size:11px;line-height:1.7;color:${C.footer}">` +
      `<a href="${escapeHtml(manage)}" style="${link}">${escapeHtml(PL.settings)}</a> \u00b7 ` +
      `<a href="${escapeHtml(manage)}" style="${link}">${escapeHtml(PL.unsubscribe)}</a> \u00b7 ` +
      `<a href="${escapeHtml(open)}" style="${link}">${escapeHtml(PL.open)}</a>` +
      `<div style="margin-top:2px">${escapeHtml(PL.sender)}</div>` +
    `</td></tr>`
  );
}

export interface BriefSection {
  /** Empty for an unnamed brief covering everything. */
  category: string;
  /**
   * How far ahead this section reached, in days (GOI-100).
   *
   * A number rather than a cadence, because a section's window is now derived
   * from the send cadence and the rule's own cadence together, plus an
   * optional lookahead override — so there is no single word that names it.
   * "Weekly theatre in a daily newsletter" and "a daily newsletter's cinema
   * looking ten days ahead" are both real, and only the span distinguishes
   * them.
   */
  windowDays: number;
  detail: NewsletterDetail;
  events: Event[];
}

export interface BriefContent {
  sections: BriefSection[];
  /** The saved-events queue (GOI-101). Rendered above every category section:
   *  it is the only part of a brief that asks the reader to do something. */
  wantToGo?: WantToGoSection;
  /** Cadence to word the masthead by when there are no sections at all —
   *  otherwise an empty weekly brief would announce itself as "Today". */
  fallbackFrequency?: NewsletterFrequency;
  /** Greeting name; null greets without one. */
  recipientName?: string | null;
  /** Festivals on now or opening soon, for the band under the queue. Chosen
   *  by `briefFestivals`, which is where "soon" is defined. */
  festivals?: Festival[];
  now?: Date;
}

/** Hidden preheader — the grey line clients show next to the subject. */
function preheader(text: string): string {
  return (
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;` +
    `font-size:1px;line-height:1px;color:${C.bg};opacity:0">${escapeHtml(text)}</div>`
  );
}

/** The span a cadence covers, in days. */
function cadenceDays(frequency: NewsletterFrequency): number {
  return frequency === 'daily' ? 1 : frequency === 'weekly' ? 7 : 30;
}

export function renderBriefHtml(content: BriefContent): string {
  const sections = content.sections;
  const now = content.now ?? new Date();
  const events = sections.flatMap((s) => s.events);
  // "N picks" counts cards, not showings: after GOI-36 a film at three
  // cinemas is one pick, and claiming three would contradict the list below.
  const pickCount = sections.reduce((n, s) => n + groupPicks(s.events).length, 0);
  const venueCount = new Set(events.map((e) => e.venueId)).size;
  // The widest cadence present sets how many days the masthead names — a brief
  // carrying a monthly section does not cover today. With nothing on, fall
  // back to the cadence the brief *would* have run at.
  const widest = sections.reduce((acc, s) => Math.max(acc, s.windowDays), 0);
  const frequency: NewsletterFrequency = sections.length
    ? (widest > 7 ? 'monthly' : widest > 1 ? 'weekly' : 'daily')
    : content.fallbackFrequency ?? 'daily';
  /**
   * How many days the masthead names.
   *
   * The *send* cadence, not the widest section — those are different numbers
   * and only one of them is the issue. A weekly brief carrying a monthly
   * museums rule has a section reaching 30 days into the future, and taking
   * that as the span made the band read "10–8 WRZEŚNIA": a range whose month
   * comes off an end date five weeks out, for an issue that covers a week.
   * `fallbackFrequency` is the send cadence at every call site.
   */
  const sendDays = cadenceDays(content.fallbackFrequency ?? frequency);

  const queue = content.wantToGo ? wantToGoBlock(content.wantToGo) : '';
  const body = events.length
    ? picksTable(sections)
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
      `style="border-collapse:collapse"><tr><td style="border-top:2px solid ${C.divider};padding:24px 0;` +
      `font-family:${FONT};font-size:13px;line-height:1.5;color:${C.body}">` +
      `${escapeHtml(PL.nothing)}</td></tr></table>`;
  const festivals = content.festivals ?? [];

  return (
    `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" ` +
      `"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">` +
    `<html xmlns="http://www.w3.org/1999/xhtml"><head>` +
      `<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />` +
      `<meta name="viewport" content="width=device-width, initial-scale=1" />` +
      `<meta name="color-scheme" content="light dark" />` +
      `<meta name="supported-color-schemes" content="light dark" />` +
      `<title>AFISZ</title>` +
    `</head>` +
    `<body style="margin:0;padding:0;background-color:${C.page};-webkit-text-size-adjust:100%">` +
      preheader(PL.summary(pickCount, venueCount)) +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
        `style="border-collapse:collapse;background-color:${C.page}">` +
        `<tr><td align="center" style="padding:0">` +
          `<table role="presentation" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0" ` +
            `style="border-collapse:collapse;width:${WIDTH}px;max-width:${WIDTH}px;background-color:${C.bg}">` +
            mastheadRow({ now, days: sendDays }) +
            summaryRow({
              picks: pickCount,
              venues: venueCount,
              name: content.recipientName?.trim() || null,
            }) +
            // The reader's own saved events first, then what is on across the
            // city, then the listings — the order GOI-110 sets out.
            (queue ? `<tr><td style="padding:0 40px">${queue}</td></tr>` : '') +
            festivalsRow(festivals) +
            `<tr><td style="padding:8px 40px 0">${body}</td></tr>` +
            footerRow() +
          `</table>` +
        `</td></tr>` +
      `</table>` +
    `</body></html>`
  );
}
