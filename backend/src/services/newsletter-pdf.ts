import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type PDFKit from 'pdfkit';
import type { Event, Festival, NewsletterFrequency } from '@afisz/shared';
import { groupPicks, listSentence, type BriefSection, type Pick } from './newsletter-render.js';

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
  tagFill: '#f0ead0',
  meta: '#8d8b87',
  body: '#575552',
  footer: '#989691',
} as const;

const PAGE = { width: 595.28, height: 841.89 }; // A4 in points
const MARGIN = 48;
const CONTENT = PAGE.width - MARGIN * 2;

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
  fallbackFrequency?: NewsletterFrequency;
  recipientName?: string | null;
  festival?: Festival | null;
  now?: Date;
}

function fmt(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts }).format(new Date(iso));
}

function cadenceLabel(frequency: NewsletterFrequency): string {
  if (frequency === 'daily') return 'today';
  return frequency === 'weekly' ? 'this week' : 'this month';
}

/** `18:00, 20:30` — every showing of one title at one venue. */
function timeList(startsAt: string[]): string {
  return startsAt.map((s) => fmt(s, { hour: '2-digit', minute: '2-digit', hour12: false })).join(', ');
}

function venueLine(pick: Pick): string {
  return pick.venues.map((v) => `${v.name} · ${timeList(v.startsAt)}`).join('   ');
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
  // The widest section decides the masthead's wording, as it does in the
  // email (GOI-100): a brief carrying a monthly section is not "today".
  const widest = sections.reduce((acc, sec) => Math.max(acc, sec.windowDays), 0);
  const frequency: NewsletterFrequency = sections.length
    ? (widest > 7 ? 'monthly' : widest > 1 ? 'weekly' : 'daily')
    : content.fallbackFrequency ?? 'weekly';

  const doc: PDFKit.PDFDocument = new PDFDocument({
    size: [PAGE.width, PAGE.height],
    margin: MARGIN,
    bufferPages: true,
    info: {
      Title: `AFISZ — what's on ${cadenceLabel(frequency)}`,
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

  drawMasthead(doc, { frequency, count: countPicks(sections), recipientName: content.recipientName, now });

  for (const section of sections) {
    drawSection(doc, section);
  }

  if (events.length === 0) {
    doc.moveDown(1);
    doc.font('body').fontSize(10).fillColor(C.meta)
      .text('Nothing on at your venues in this window.', MARGIN, doc.y, { width: CONTENT });
  }

  if (content.festival) drawFestival(doc, content.festival);
  drawFooter(doc, sections);

  doc.end();
  return done;
}

function countPicks(sections: BriefSection[]): number {
  return sections.reduce((n, s) => n + groupPicks(s.events).length, 0);
}

function paintPageBackground(doc: PDFKit.PDFDocument): void {
  doc.save().rect(0, 0, PAGE.width, PAGE.height).fill(C.bg).restore();
}

function drawMasthead(
  doc: PDFKit.PDFDocument,
  args: { frequency: NewsletterFrequency; count: number; recipientName?: string | null; now: Date },
): void {
  const height = 128;
  doc.save().rect(0, 0, PAGE.width, height).fill(C.ink).restore();

  doc.font('body').fontSize(8).fillColor(C.onInkEyebrow)
    .text(fmt(args.now.toISOString(), { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase(),
      MARGIN, 30, { width: CONTENT, characterSpacing: 2 });

  doc.font('bold').fontSize(38).fillColor(C.onInk)
    .text('AFISZ', MARGIN, 48, { width: CONTENT, characterSpacing: 1 });

  const greeting = args.recipientName ? `${args.recipientName}, here's` : "Here's";
  const picks = args.count === 1 ? '1 pick' : `${args.count} picks`;
  doc.font('body').fontSize(10).fillColor(C.onInkEyebrow)
    .text(`${greeting} what's on ${cadenceLabel(args.frequency)} — ${picks}.`,
      MARGIN, 96, { width: CONTENT });

  doc.y = height + 28;
}

function drawSection(doc: PDFKit.PDFDocument, section: BriefSection): void {
  const picks = groupPicks(section.events);
  if (picks.length === 0) return;

  if (section.category) {
    ensureSpace(doc, 44);
    doc.font('bold').fontSize(9).fillColor(C.ink)
      .text(section.category.toUpperCase(), MARGIN, doc.y, { width: CONTENT, characterSpacing: 2 });
    doc.moveDown(0.4);
    rule(doc);
    doc.moveDown(0.6);
  }

  for (const pick of picks) {
    drawPick(doc, pick, section.detail === 'full');
  }
}

/**
 * One pick: day + title, then venues and times, then the blurb on a full brief.
 *
 * Height is measured before drawing so a card is never split across a page
 * break — a title stranded at the foot of one page with its times at the head
 * of the next is the sort of thing that makes a generated PDF look generated.
 */
function drawPick(doc: PDFKit.PDFDocument, pick: Pick, full: boolean): void {
  const title = pick.lead.title;
  const day = fmt(pick.startsAt, { weekday: 'short', day: 'numeric', month: 'short' });
  const venues = venueLine(pick);
  const blurb = full && pick.lead.description ? pick.lead.description : null;

  const titleHeight = doc.font('bold').fontSize(13).heightOfString(title, { width: CONTENT });
  const venueHeight = doc.font('body').fontSize(9).heightOfString(venues, { width: CONTENT });
  const blurbHeight = blurb
    ? doc.font('body').fontSize(9.5).heightOfString(blurb, { width: CONTENT })
    : 0;
  ensureSpace(doc, 16 + titleHeight + venueHeight + blurbHeight + 22);

  doc.font('body').fontSize(8).fillColor(C.meta)
    .text(day.toUpperCase(), MARGIN, doc.y, { width: CONTENT, characterSpacing: 1.4 });
  doc.moveDown(0.25);

  doc.font('bold').fontSize(13).fillColor(C.ink)
    .text(title, MARGIN, doc.y, { width: CONTENT });
  doc.moveDown(0.2);

  doc.font('body').fontSize(9).fillColor(C.body)
    .text(venues, MARGIN, doc.y, { width: CONTENT });

  if (pick.count > pick.venues.length) {
    doc.font('body').fontSize(8).fillColor(C.meta)
      .text(`${pick.count} showings`, MARGIN, doc.y + 1, { width: CONTENT });
  }

  if (blurb) {
    doc.moveDown(0.3);
    doc.font('body').fontSize(9.5).fillColor(C.body).text(blurb, MARGIN, doc.y, { width: CONTENT });
  }

  doc.moveDown(0.5);
  rule(doc, C.divider, 0.5);
  doc.moveDown(0.6);
}

function drawFestival(doc: PDFKit.PDFDocument, festival: Festival): void {
  ensureSpace(doc, 60);
  doc.moveDown(0.4);
  doc.save().rect(MARGIN, doc.y, CONTENT, 3).fill(C.tagFill).restore();
  doc.moveDown(0.6);

  const through = fmt(`${festival.endDate}T12:00:00Z`, { day: 'numeric', month: 'short' });
  doc.font('bold').fontSize(9).fillColor(C.ink)
    .text('ALSO ON', MARGIN, doc.y, { width: CONTENT, characterSpacing: 2 });
  doc.moveDown(0.3);
  doc.font('body').fontSize(10).fillColor(C.body)
    .text(`${festival.name} — through ${through}`, MARGIN, doc.y, { width: CONTENT });
}

function drawFooter(doc: PDFKit.PDFDocument, sections: BriefSection[]): void {
  const categories = sections.map((s) => s.category).filter(Boolean);
  ensureSpace(doc, 60);
  doc.moveDown(1);
  rule(doc);
  doc.moveDown(0.6);

  const scope = categories.length ? `Covering ${listSentence(categories)}.` : 'Covering your venues.';
  doc.font('body').fontSize(8).fillColor(C.footer)
    .text(`${scope} Change what's in this brief at afisz.cc/my.`, MARGIN, doc.y, { width: CONTENT });
}

function rule(doc: PDFKit.PDFDocument, color: string = C.ink, weight = 1): void {
  doc.save().rect(MARGIN, doc.y, CONTENT, weight).fill(color).restore();
  doc.y += weight;
}

/** Break to a new page when `needed` points won't fit under the current one. */
function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > PAGE.height - MARGIN) doc.addPage();
}
