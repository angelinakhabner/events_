import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type PDFKit from 'pdfkit';
import type { Event, Festival, NewsletterFrequency } from '@afisz/shared';
import { isExhibition } from '@afisz/shared';
import { groupPicks, type BriefSection, type Pick } from './newsletter-render.js';
import { isEmptySection, type QueuedChange, type WantToGoSection } from './want-to-go-queue.js';
import { env } from '../config.js';
import {
  PL, closingDate, dateRange, festivalSpan, shortDate, time, weekday,
} from './newsletter-copy.js';

/**
 * The brief as a PDF (GOI-91), for the copy that gets filed on a user's drive.
 *
 * Deliberately *not* the email HTML converted. Converting would mean shipping a
 * headless browser to Railway — a ~300MB dependency and a cold start measured
 * in seconds, on a service whose whole job is answering small queries — and the
 * email markup is nested presentation tables built for Outlook, which is the
 * worst possible input to a layout engine. Both renderers instead draw from the
 * same `BriefSection[]`, so the PDF and the email say the same thing without
 * either being derived from the other.
 *
 * Polish copy is the reason the fonts are embedded rather than using PDF's
 * built-in Helvetica: the standard-14 fonts are WinAnsi-encoded, which has no
 * ł, ą, ę, ś, ż, ź, ć or ń — every Polish title would silently lose letters.
 * `assets/fonts/*.subset.ttf` are DejaVu Sans cut down to Latin-1 + Latin
 * Extended-A, 22KB each instead of 750KB.
 */

// pdfkit is CommonJS and its default export is the constructor; `createRequire`
// avoids the interop guesswork of importing it through ESM.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PDFDocument = require('pdfkit') as any;

const TZ = 'Europe/Warsaw';

/** Design tokens, matching `newsletter-render.ts`'s flattened palette. */
const C = {
  bg: '#faf8f0',
  ink: '#1a1712',
  onInk: '#f3f2f2',
  onInkEyebrow: '#d2d1d0',
  divider: '#aca9a2',
  /** --color-accent, the same red the site sets links and the wordmark's
   *  square in. It carries the times and the state labels here. */
  accent: '#c62828',
  tagFill: '#f0ead0',
  meta: '#8d8b87',
  body: '#575552',
  footer: '#989691',
} as const;

const PAGE = { width: 595.28, height: 841.89 }; // A4 in points
const MARGIN = 48;
const CONTENT = PAGE.width - MARGIN * 2;

/**
 * The left column the times and state markers sit in.
 *
 * A fixed gutter rather than a time prefixed to each title: it is what lets a
 * reader run their eye down the times alone to find the evening they are free,
 * without reading a word of the titles beside them. Wide enough for `18:30` at
 * 10pt and for `OSTATNIA` — the longest marker — at 8pt, with room to breathe.
 */
const GUTTER = 52;
const BODY_X = MARGIN + GUTTER;
const BODY_WIDTH = CONTENT - GUTTER;

/** Inset of text inside a black band, which is itself inset by `MARGIN`. */
const BAND_PAD = 20;

const FONT_REGULAR_FILE = 'DejaVuSans.subset.ttf';
const FONT_BOLD_FILE = 'DejaVuSans-Bold.subset.ttf';

/**
 * Where `backend/assets/fonts` actually is, found by walking up (GOI-96).
 *
 * It used to be `../../assets/fonts` from this module, which is right when
 * this file runs as TypeScript out of `backend/src/services` and wrong
 * everywhere else. `tsc` emits to `backend/dist/backend/src/services`, and
 * nothing copies `assets/` into `dist`, so in production that same relative
 * path pointed at `backend/dist/backend/assets/fonts` — a directory that has
 * never existed. The only symptom was the brief refusing to render, with
 * "ENOENT: no such file or directory" naming a path deep inside `dist` that
 * gives no hint the fonts are sitting unbuilt two levels above it.
 *
 * Walking up until the directory turns up is indifferent to how deep the
 * compiler nests its output, so dev, `dist`, and the test runner all resolve
 * to the one copy of the fonts in the repo instead of three guesses at it.
 */
export function resolveFontDir(startDir: string): string {
  let dir = startDir;
  // `backend/dist/backend/src/services` is five levels below `backend/`, so
  // the bound is generous rather than tight; the loop stops at the filesystem
  // root regardless.
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'assets', 'fonts');
    if (existsSync(path.join(candidate, FONT_REGULAR_FILE))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not find ${FONT_REGULAR_FILE}: no assets/fonts directory above ` +
      `${startDir}. The brief needs the embedded DejaVu subset to set Polish text.`,
  );
}

/** Read once, not per brief — the sweep renders one of these per subscriber. */
let fontCache: { regular: Uint8Array; bold: Uint8Array } | null = null;

/**
 * The font bytes, as a `Uint8Array` built by *this* realm's constructor.
 *
 * That copy is not ceremony. `readFileSync` returns a Node `Buffer`, and
 * fontkit (which pdfkit parses fonts with) sniffs the format behind an
 * `instanceof Uint8Array` check. Under a jsdom test environment the global
 * `Uint8Array` belongs to jsdom's realm while the Buffer belongs to Node's, so
 * that check is false for a perfectly valid TTF and the only symptom is
 * "Not a supported font format or standard PDF font" — which reads like a
 * corrupt file and is nothing of the kind. `new Uint8Array(buf)` is
 * constructed by whichever realm is current, so it satisfies the check in
 * both. The frontend's newsletter end-to-end test mounts this backend
 * in-process under jsdom, which is how it got found.
 */
function fonts(): { regular: Uint8Array; bold: Uint8Array } {
  if (!fontCache) {
    const dir = resolveFontDir(path.dirname(fileURLToPath(import.meta.url)));
    fontCache = {
      regular: new Uint8Array(readFileSync(path.join(dir, FONT_REGULAR_FILE))),
      bold: new Uint8Array(readFileSync(path.join(dir, FONT_BOLD_FILE))),
    };
  }
  return fontCache;
}


export interface BriefPdfContent {
  sections: BriefSection[];
  /**
   * The saved-events queue (GOI-101), at the top of the brief.
   *
   * The PDF went without it when the queue was built, because the PDF was a
   * filed copy of an email that carried it. Once a reader can choose the drive
   * *instead* of the email, that omission means the one thing in the brief
   * that asks them to do something never reaches them.
   */
  wantToGo?: WantToGoSection;
  fallbackFrequency?: NewsletterFrequency;
  recipientName?: string | null;
  /** Festivals on now or opening soon — see `briefFestivals`. */
  festivals?: Festival[];
  now?: Date;
}

/**
 * The filename a drive copy is filed under.
 *
 * Date-first so a folder listing sorts chronologically on name alone, which is
 * what a drive UI sorts by default. ISO rather than a localised date for the
 * same reason.
 */
export function briefPdfFilename(now: Date, frequency: NewsletterFrequency): string {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return `afisz-${day}-${frequency}.pdf`;
}

/**
 * Draw the brief and resolve with the finished PDF bytes.
 *
 * Buffered rather than streamed: a brief is a handful of pages, both consumers
 * (the drive upload and the download button) need the whole thing in memory
 * anyway, and a stream would make the byte count unavailable until after the
 * upload had to declare it.
 */
export function renderBriefPdf(content: BriefPdfContent): Promise<Buffer> {
  const now = content.now ?? new Date();
  const sections = content.sections;
  const events: Event[] = sections.flatMap((s) => s.events);
  const queue = content.wantToGo;
  // The widest section decides how far the masthead's date range reaches, as
  // it decides the email's wording (GOI-100).
  const widest = sections.reduce((acc, sec) => Math.max(acc, sec.windowDays), 0);
  const frequency: NewsletterFrequency = sections.length
    ? (widest > 7 ? 'monthly' : widest > 1 ? 'weekly' : 'daily')
    : content.fallbackFrequency ?? 'weekly';

  const doc: PDFKit.PDFDocument = new PDFDocument({
    size: [PAGE.width, PAGE.height],
    margin: MARGIN,
    bufferPages: true,
    info: {
      Title: `${PL.wordmark} — ${PL.city}`,
      Author: 'AFISZ',
      Creator: 'AFISZ',
      CreationDate: now,
    },
  });

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const face = fonts();
  doc.registerFont('body', face.regular);
  doc.registerFont('bold', face.bold);

  paintPageBackground(doc);
  // Every page break repaints the ground — pdfkit's `margin` reserves space but
  // draws nothing, so without this the second page onwards would be white.
  doc.on('pageAdded', () => paintPageBackground(doc));

  drawMasthead(doc, { now, days: widest || (frequency === 'daily' ? 1 : 7) });
  drawSummary(doc, {
    picks: countPicks(sections),
    venues: countVenues(sections),
    name: content.recipientName?.trim() || null,
  });

  if (queue) drawWantToGo(doc, queue);
  drawFestivals(doc, content.festivals ?? []);

  for (const section of sections) {
    drawSection(doc, section);
  }

  if (events.length === 0 && (!queue || isEmptySection(queue))) {
    doc.moveDown(1);
    doc.font('body').fontSize(10).fillColor(C.meta)
      .text(PL.nothing, MARGIN, doc.y, { width: CONTENT });
  }

  drawFooter(doc);

  doc.end();
  return done;
}

function countPicks(sections: BriefSection[]): number {
  return sections.reduce((n, s) => n + groupPicks(s.events).length, 0);
}

/** How many of the reader's venues the brief actually drew on. */
function countVenues(sections: BriefSection[]): number {
  const seen = new Set<string>();
  for (const s of sections) for (const e of s.events) seen.add(e.venueId);
  return seen.size;
}

function paintPageBackground(doc: PDFKit.PDFDocument): void {
  doc.save().rect(0, 0, PAGE.width, PAGE.height).fill(C.bg).restore();
}

// ─── The masthead ────────────────────────────────────────────────────────────

/**
 * The black band: the wordmark with its red square, the span the brief covers,
 * and the city.
 *
 * Inset by the page margin rather than bled to the paper's edge. A full-bleed
 * band is the right call on screen and the wrong one on paper: consumer
 * printers reserve an unprintable margin and scale the page down to fit it, so
 * a band drawn to the edge either loses a strip or shifts the whole brief. A
 * filed PDF is the copy people print.
 */
function drawMasthead(doc: PDFKit.PDFDocument, args: { now: Date; days: number }): void {
  const top = MARGIN;
  const height = 120;
  const x = MARGIN + BAND_PAD;
  const width = CONTENT - BAND_PAD * 2;
  doc.save().rect(MARGIN, top, CONTENT, height).fill(C.ink).restore();

  doc.font('bold').fontSize(26).fillColor(C.onInk)
    .text(PL.wordmark, x, top + 22, { width, characterSpacing: 0.5 });
  // The square is placed off the wordmark's measured width, not a guessed
  // offset, so it stays put if the mark or its size ever changes.
  const markWidth = doc.font('bold').fontSize(26).widthOfString(PL.wordmark);
  doc.save().rect(x + markWidth + 10, top + 30, 9, 9).fill(C.accent).restore();

  doc.font('bold').fontSize(8).fillColor(C.accent)
    .text(dateRange(args.now, args.days), x, top + 56, { width, characterSpacing: 2 });

  doc.font('bold').fontSize(30).fillColor(C.onInk)
    .text(PL.city, x, top + 72, { width, characterSpacing: 1 });

  doc.y = top + height + 20;
}

/** One line of arithmetic under the masthead: how much is here, from where.
 *  Closed by the same heavy rule that closes a section heading, so the header
 *  block reads as one thing rather than as a stray sentence. */
function drawSummary(
  doc: PDFKit.PDFDocument,
  args: { picks: number; venues: number; name: string | null },
): void {
  const count = PL.summary(args.picks, args.venues);
  doc.font('body').fontSize(10).fillColor(C.body)
    .text(args.name ? PL.addressed(args.name, count) : count, MARGIN, doc.y, { width: CONTENT });
  doc.moveDown(0.9);
  rule(doc, C.ink, 2);
}

// ─── "Chcę iść" ──────────────────────────────────────────────────────────────

/**
 * The saved-events queue, above every category section (GOI-101).
 *
 * Grouped by state under its own subheading rather than listed flat, because
 * the states are not degrees of the same thing — "this was cancelled", "this
 * is your last chance" and "this is tomorrow" are three different requests,
 * and a reader scanning for the urgent one should not have to read the times.
 * Changes lead: something that happened outranks something that is coming.
 */
function drawWantToGo(doc: PDFKit.PDFDocument, section: WantToGoSection): void {
  if (isEmptySection(section)) return;

  // A queue row is a fixed shape — one line of title over one of meta — so its
  // height is a constant here rather than a measurement, unlike a pick's.
  sectionHeading(doc, PL.wantToGo, 34 + QUEUE_ROW_HEIGHT);

  if (section.changes.length > 0) {
    subHeading(doc, PL.changes);
    for (const change of section.changes) {
      drawQueueRow(doc, {
        // See the note in `newsletter-render.ts`: the subheading above
        // already says these are changes, so the gutter carries the day.
        gutter: weekday(change.event.startsAt),
        gutterColor: C.accent,
        title: change.event.title,
        meta: [change.event.venue?.name, changeNote(change)].filter(Boolean).join(' · '),
      });
    }
  }

  for (const [state, label] of [
    ['last_chance', PL.lastChance],
    ['tomorrow', PL.tomorrow],
    ['this_week', PL.thisWeek],
  ] as const) {
    const rows = section.reminders.filter((r) => r.state === state);
    if (rows.length === 0) continue;
    subHeading(doc, label);
    for (const row of rows) {
      drawQueueRow(doc, {
        // A reminder for tomorrow is about a time; one for later in the week
        // is about a day. The gutter shows whichever the reader needs.
        gutter: state === 'tomorrow' ? time(row.event.startsAt) : weekday(row.event.startsAt),
        gutterColor: C.accent,
        title: row.event.title,
        meta: [row.event.venue?.name, state === 'tomorrow' ? null : time(row.event.startsAt)]
          .filter(Boolean).join(' · '),
      });
    }
  }

  doc.moveDown(0.5);
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

/** Title, meta and the rule under them, for a queue row of one-line title. */
const QUEUE_ROW_HEIGHT = 44;

/** A queue row: a short marker in the gutter, title and meta beside it. */
function drawQueueRow(
  doc: PDFKit.PDFDocument,
  args: { gutter: string; gutterColor: string; title: string; meta: string },
): void {
  const titleHeight = doc.font('bold').fontSize(12).heightOfString(args.title, { width: BODY_WIDTH });
  ensureSpace(doc, titleHeight + 26);

  const top = doc.y;
  doc.font('bold').fontSize(8).fillColor(args.gutterColor)
    .text(args.gutter, MARGIN, top + 2, { width: GUTTER - 8, characterSpacing: 1 });

  doc.font('bold').fontSize(12).fillColor(C.ink)
    .text(args.title, BODY_X, top, { width: BODY_WIDTH });
  if (args.meta) {
    doc.font('bold').fontSize(7.5).fillColor(C.body)
      .text(args.meta.toUpperCase(), BODY_X, doc.y + 1, { width: BODY_WIDTH, characterSpacing: 0.8 });
  }

  doc.moveDown(0.55);
  rule(doc, C.divider, 0.5);
  doc.moveDown(0.55);
}

// ─── Festivals ───────────────────────────────────────────────────────────────

/** The black band of what is running across the city this week. */
function drawFestivals(doc: PDFKit.PDFDocument, festivals: Festival[]): void {
  if (festivals.length === 0) return;
  const height = 34 + festivals.length * 20;
  ensureSpace(doc, height + 22);

  const top = doc.y;
  const x = MARGIN + BAND_PAD;
  const width = CONTENT - BAND_PAD * 2;
  doc.save().rect(MARGIN, top, CONTENT, height).fill(C.ink).restore();

  doc.font('bold').fontSize(7.5).fillColor(C.accent)
    .text(PL.festivals.toUpperCase(), x, top + 13, { width, characterSpacing: 1.6 });

  let y = top + 32;
  for (const f of festivals) {
    doc.font('bold').fontSize(11).fillColor(C.onInk).text(f.name, x, y, { width });
    const nameWidth = doc.font('bold').fontSize(11).widthOfString(f.name);
    doc.font('bold').fontSize(7.5).fillColor(C.onInkEyebrow)
      .text(festivalSpan(f), x + nameWidth + 10, y + 3, { width, characterSpacing: 1 });
    y += 20;
  }

  doc.y = top + height + 22;
}

// ─── Category sections ───────────────────────────────────────────────────────

function drawSection(doc: PDFKit.PDFDocument, section: BriefSection): void {
  const picks = groupPicks(section.events);
  if (picks.length === 0) return;

  // The heading is kept with the row it opens. A "TEATR" alone at the foot of
  // a page, with the first play at the head of the next, is worse than a page
  // that ends a few centimetres early.
  if (section.category) sectionHeading(doc, section.category, rowHeight(doc, picks[0]!, section));

  for (const pick of picks) {
    // An exhibition has no showtime worth putting in a gutter — it is on all
    // day for months — so it is dated by when it closes instead (GOI-67).
    if (isExhibition(pick.lead)) drawExhibition(doc, pick, section.detail);
    else drawPick(doc, pick, section);
  }
}

/** The blurb a section's detail level asks for, or none. */
function blurbFor(pick: Pick, detail: BriefSection['detail']): string | null {
  const text = pick.lead.description;
  if (!text || detail === 'line') return null;
  return detail === 'full' ? text : firstSentence(text);
}

/**
 * How tall a row will be, measured before anything is drawn.
 *
 * Shared by the row itself and by the heading above it, which is the point:
 * both page-break decisions are then made from the same number, so a heading
 * can never reserve space its own first row does not fit into.
 */
function rowHeight(doc: PDFKit.PDFDocument, pick: Pick, section: BriefSection): number {
  const exhibition = isExhibition(pick.lead);
  const width = exhibition ? CONTENT : BODY_WIDTH;
  const blurb = blurbFor(pick, section.detail);
  const title = doc.font('bold').fontSize(13).heightOfString(pick.lead.title, { width });
  const body = blurb ? doc.font('body').fontSize(9).heightOfString(blurb, { width }) : 0;
  if (exhibition) return title + body + 34;
  const dated = section.windowDays > 1 ? 12 : 0;
  return title + body + pick.venues.length * 12 + dated + 30;
}

/**
 * One timed pick: the first showing's time in the gutter, the title beside it,
 * then a line per venue and the blurb.
 *
 * Height is measured before drawing so a card is never split across a page
 * break — a title stranded at the foot of one page with its times at the head
 * of the next is the sort of thing that makes a generated PDF look generated.
 */
function drawPick(doc: PDFKit.PDFDocument, pick: Pick, section: BriefSection): void {
  const title = pick.lead.title;
  const blurb = blurbFor(pick, section.detail);
  // A section spanning more than a day has to date each row; a single-day one
  // would only be repeating its own heading.
  const dateLine = section.windowDays > 1 ? shortDate(pick.startsAt) : null;

  ensureSpace(doc, rowHeight(doc, pick, section));

  const top = doc.y;
  doc.font('bold').fontSize(10).fillColor(C.accent)
    .text(time(pick.startsAt), MARGIN, top + 1, { width: GUTTER - 8 });

  if (dateLine) {
    doc.font('bold').fontSize(7.5).fillColor(C.meta)
      .text(dateLine, BODY_X, top, { width: BODY_WIDTH, characterSpacing: 1 });
    doc.moveDown(0.15);
  }

  doc.font('bold').fontSize(13).fillColor(C.ink)
    .text(title, BODY_X, dateLine ? doc.y : top, { width: BODY_WIDTH });

  // One line per venue, so two cinemas showing the same film read as two
  // places rather than as one run-on string.
  for (const v of pick.venues) {
    doc.font('bold').fontSize(7.5).fillColor(C.body)
      .text(`${v.name} · ${v.startsAt.map(time).join(', ')}`.toUpperCase(),
        BODY_X, doc.y + 2, { width: BODY_WIDTH, characterSpacing: 0.8 });
  }

  if (blurb) {
    doc.font('body').fontSize(9).fillColor(C.body)
      .text(blurb, BODY_X, doc.y + 4, { width: BODY_WIDTH });
  }

  doc.moveDown(0.55);
  rule(doc, C.divider, 0.5);
  doc.moveDown(0.55);
}

/** An exhibition: dated by its closing, with no gutter time. */
function drawExhibition(doc: PDFKit.PDFDocument, pick: Pick, detail: BriefSection['detail']): void {
  const title = pick.lead.title;
  const blurb = blurbFor(pick, detail);
  const closes = pick.lead.endsAt ? closingDate(pick.lead.endsAt) : null;
  const eyebrow = [closes, pick.venues[0]?.name.toUpperCase()].filter(Boolean).join(' · ');

  ensureSpace(doc, rowHeight(doc, pick, { detail, windowDays: 1, category: '', events: [] }));

  doc.font('bold').fontSize(7.5).fillColor(C.accent)
    .text(eyebrow, MARGIN, doc.y, { width: CONTENT, characterSpacing: 1 });
  doc.font('bold').fontSize(13).fillColor(C.ink)
    .text(title, MARGIN, doc.y + 2, { width: CONTENT });
  if (blurb) {
    doc.font('body').fontSize(9).fillColor(C.body)
      .text(blurb, MARGIN, doc.y + 3, { width: CONTENT });
  }

  doc.moveDown(0.55);
  rule(doc, C.divider, 0.5);
  doc.moveDown(0.55);
}

/** The first sentence of a blurb, for a section set to `short`. */
function firstSentence(text: string): string {
  const end = text.search(/[.!?](\s|$)/);
  return end === -1 ? text : text.slice(0, end + 1);
}

// ─── Chrome ──────────────────────────────────────────────────────────────────

/** A section title over the heavy rule that separates it from what it opens.
 *  `keepWith` is the height of whatever follows, so the two break together. */
function sectionHeading(doc: PDFKit.PDFDocument, label: string, keepWith = 0): void {
  ensureSpace(doc, 52 + keepWith);
  doc.moveDown(0.5);
  doc.font('bold').fontSize(9.5).fillColor(C.ink)
    .text(label.toUpperCase(), MARGIN, doc.y, { width: CONTENT, characterSpacing: 2 });
  doc.moveDown(0.45);
  rule(doc, C.ink, 2);
  doc.moveDown(0.7);
}

/** A state's name inside the queue — smaller, red, no rule of its own. */
function subHeading(doc: PDFKit.PDFDocument, label: string): void {
  ensureSpace(doc, 34);
  doc.font('bold').fontSize(7.5).fillColor(C.accent)
    .text(label.toUpperCase(), MARGIN, doc.y, { width: CONTENT, characterSpacing: 1.6 });
  doc.moveDown(0.45);
}

/**
 * The footer, whose three links are real PDF annotations rather than styled
 * text.
 *
 * That is not decoration. A reader who chose `drive` gets no email, so this
 * page is the only place their newsletter can offer them a way to change its
 * settings or stop it — and a printed-looking word that happens to say
 * "Wypisz się" is not one. Drawn link by link so each carries its own target.
 */
function drawFooter(doc: PDFKit.PDFDocument): void {
  ensureSpace(doc, 60);
  doc.moveDown(1);
  rule(doc, C.ink, 2);
  doc.moveDown(0.7);

  const settings = `${env.APP_URL}/my?tab=newsletter`;
  const links: [string, string][] = [
    [PL.settings, settings],
    [PL.unsubscribe, settings],
    [PL.open, `${env.APP_URL}/my`],
  ];

  const top = doc.y;
  let x = MARGIN;
  doc.font('body').fontSize(8.5);
  links.forEach(([label, href], i) => {
    const text = i === links.length - 1 ? label : `${label} · `;
    // `continued` would reflow the whole run and lose the per-link x, so each
    // piece is placed at a measured offset instead.
    doc.fillColor(C.accent).text(label, x, top, { width: CONTENT, link: href, underline: true });
    x += doc.widthOfString(text);
    if (i < links.length - 1) {
      doc.fillColor(C.body)
        .text(' · ', x - doc.widthOfString(' · '), top, { width: CONTENT, link: null, underline: false });
    }
  });

  doc.fillColor(C.footer).font('body').fontSize(8)
    .text(`${PL.wordmark} · afisz.cc`, MARGIN, top + 13, { width: CONTENT, link: null, underline: false });
}

function rule(doc: PDFKit.PDFDocument, color: string = C.ink, weight = 1): void {
  doc.save().rect(MARGIN, doc.y, CONTENT, weight).fill(color).restore();
  doc.y += weight;
}

/** Break to a new page when `needed` points won't fit under the current one. */
function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > PAGE.height - MARGIN) doc.addPage();
}
