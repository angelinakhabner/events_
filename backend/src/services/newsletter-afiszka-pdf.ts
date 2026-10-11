import { createRequire } from 'node:module';
import type PDFKit from 'pdfkit';
import { PL, festivalSpan, time, weekday } from './newsletter-copy.js';
import { loadFont } from './pdf-fonts.js';
import {
  AFISZKA, barSpan, buildAfiszkaIssue, dateRun, dayNumber, describe, frontWhen, isReferenced,
  entryWhen, metaLine, pickReasonLabel, monthAbbr, runLabel,
  type AfiszkaBlock, type AfiszkaContent, type AfiszkaEntry, type AfiszkaIssue, type AfiszkaSection,
} from './newsletter-afiszka.js';

/**
 * The AFISZ.KA newsletter as an A4 PDF — the print piece the redesign
 * handoff describes, drawn with pdfkit rather than through a headless browser
 * for the reason `newsletter-pdf.ts` gives (no 300MB Chromium on Railway).
 *
 * Pagination is measured, not estimated: every block is measured before it is
 * drawn, and one that would cross the foot of a sheet starts a new one whose
 * header names the section and its scope ("Teatr · Tydzień 2", never "cont.").
 * "Arkusz X z N" and the contents' sheet references are filled in after
 * layout, once N and every section's sheets are known.
 *
 * The design is specified in CSS pixels on a 794×1123 page; A4 is 595×842pt,
 * so every design measurement goes through `px()`.
 */

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PDFDocument = require('pdfkit') as any;

const PAGE = { width: 595.28, height: 841.89 };
const px = (n: number) => n * 0.75;
const PAD = { top: px(44), side: px(46), bottom: px(34) };
const X0 = PAD.side;
const W = PAGE.width - PAD.side * 2;
const FOOT_H = px(26);
const LIMIT = PAGE.height - PAD.bottom - FOOT_H;

/** Modernist tokens (handoff §9). */
const C = {
  bg: '#f3f2f2',
  text: '#201e1d',
  accent: '#ec3013',
  accent100: '#fff2ef',
  accent700: '#ae1800',
  n300: '#d7d3d3',
  n700: '#605d5d',
  divider: '#9f9d9d',
} as const;

type Weight = 'r' | 'b' | 'x';

/** Archivo, cut to Latin + Latin Extended-A so Polish sets correctly — the
 *  same subsets the daily poster embeds. */
const FILES: Record<Weight, string> = {
  r: 'Archivo-Regular.subset.ttf',
  b: 'Archivo-Bold.subset.ttf',
  x: 'Archivo-ExtraBold.subset.ttf',
};

interface TextOpts {
  weight?: Weight;
  size: number;
  color?: string;
  width?: number;
  /** Letter-spacing in em, as the design gives it. */
  track?: number;
  upper?: boolean;
  align?: 'left' | 'right' | 'center';
  /** Line height as a multiple of the size. */
  lh?: number;
  tnum?: boolean;
  link?: string | null;
}

const upper = (s: string) => s.toLocaleUpperCase('pl-PL');

/** One issue being drawn: the document, the cursor, and what layout learnt. */
class Sheet {
  y = PAD.top;
  page = 0;
  /** Section index → the sheets it spans, for the contents references. */
  readonly spans = new Map<number, { from: number; to: number }>();
  /** Contents rows waiting for their sheet reference. */
  readonly refs: { page: number; y: number; section: number }[] = [];

  constructor(readonly doc: PDFKit.PDFDocument) {}

  private prep(s: string, o: TextOpts) {
    const text = o.upper ? upper(s) : s;
    this.doc.font(o.weight ?? 'r').fontSize(o.size);
    const lineGap = o.lh ? o.size * o.lh - this.doc.currentLineHeight(false) : 0;
    return {
      text,
      opts: {
        width: o.width ?? W,
        characterSpacing: (o.track ?? 0) * o.size,
        align: o.align ?? 'left',
        lineGap,
        ...(o.tnum ? { features: ['tnum'] as PDFKit.Mixins.OpenTypeFeatures[] } : {}),
      },
    };
  }

  measure(s: string, o: TextOpts): number {
    if (!s) return 0;
    const { text, opts } = this.prep(s, o);
    return this.doc.heightOfString(text, opts);
  }

  /** Draw text at (x, y) and return its height. */
  text(s: string, x: number, y: number, o: TextOpts): number {
    if (!s) return 0;
    const { text, opts } = this.prep(s, o);
    const h = this.doc.heightOfString(text, opts);
    this.doc.fillColor(o.color ?? C.text).text(text, x, y, {
      ...opts,
      ...(o.link ? { link: o.link } : {}),
      lineBreak: true,
    });
    return h;
  }

  rule(y: number, weight: number, color: string, x = X0, w = W): void {
    this.doc.save().rect(x, y, w, weight).fill(color).restore();
  }

  vrule(x: number, y: number, h: number, weight: number, color: string): void {
    this.doc.save().rect(x, y, weight, h).fill(color).restore();
  }

  fill(x: number, y: number, w: number, h: number, color: string): void {
    this.doc.save().rect(x, y, w, h).fill(color).restore();
  }

  star(cx: number, cy: number, r: number, color: string): void {
    const pts: [number, number][] = [];
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : r * 0.45;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
    }
    this.doc.save().polygon(...pts).fill(color).restore();
  }

  newPage(): void {
    this.doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
    this.page += 1;
    this.fill(0, 0, PAGE.width, PAGE.height, C.bg);
    this.y = PAD.top;
  }

  /** Make room for `h`; when it will not fit, start a sheet and draw `cont`. */
  ensure(h: number, cont: () => void): void {
    if (this.y + h <= LIMIT) return;
    this.newPage();
    cont();
  }

  markSection(index: number): void {
    const span = this.spans.get(index);
    if (span) span.to = this.page + 1;
    else this.spans.set(index, { from: this.page + 1, to: this.page + 1 });
  }
}

// ─── Front page ──────────────────────────────────────────────────────────────

/** The brand's address, as the daily poster prints it. */
const SITE = 'afisz.cc';

function masthead(s: Sheet, issue: AfiszkaIssue): void {
  const size = px(82);
  const doc = s.doc;
  const top = s.y;
  doc.font('x').fontSize(size);
  const track = -0.045 * size;
  const head = AFISZKA.wordmark.head;
  const tail = AFISZKA.wordmark.tail;
  // One run of text, so the dot sits in the word's own tracking rather than
  // at a position measured beside it.
  const y = top - size * 0.2;
  doc.fillColor(C.text).text(head, X0, y, { characterSpacing: track, lineBreak: false, continued: true })
    .fillColor(C.accent).text('.', { characterSpacing: track, continued: true })
    .fillColor(C.text).text(tail, { characterSpacing: track });
  const capBottom = top + size * 0.74;

  const lines = [
    AFISZKA.edition[issue.frequency],
    issue.issueNo ? `Nr ${issue.issueNo}` : PL.city,
    SITE,
  ];
  const lh = px(11) * 1.5;
  lines.forEach((line, i) => {
    s.text(line, X0, capBottom - lh * (lines.length - i) - px(4), {
      size: px(11), weight: 'b', track: 0.18, upper: true, align: 'right', width: W,
    });
  });
  s.y = capBottom + px(10);
  s.rule(s.y, px(2), C.divider);
  s.y += px(2);
}

function factBand(s: Sheet, issue: AfiszkaIssue): void {
  const cellW = W / 4;
  const top = s.y;
  let h = 0;
  issue.facts.forEach((f, i) => {
    const x = X0 + i * cellW + (i === 0 ? 0 : px(12));
    const w = cellW - px(i === 0 || i === 3 ? 12 : 24);
    let y = top + px(10);
    y += s.text(f.label, x, y, { size: px(11), weight: 'b', track: 0.16, upper: true, width: w });
    y += s.text(f.value, x, y + 1, { size: px(19), weight: 'x', track: -0.01, width: w, lh: 1.05 });
    h = Math.max(h, y - top + px(10));
  });
  for (let i = 1; i < 4; i++) s.vrule(X0 + i * cellW, top, h, px(2), C.divider);
  s.y = top + h;
  s.rule(s.y, px(2), C.divider);
  s.y += px(2) + px(8);
  s.y += s.text(issue.dedication, X0, s.y, {
    size: px(12), weight: 'b', track: 0.14, upper: true, color: C.accent700,
  });
  s.y += px(12);
}

function hero(s: Sheet, issue: AfiszkaIssue, e: AfiszkaEntry): void {
  const pad = { x: px(18), y: px(14) };
  const leftW = px(150);
  const rightX = X0 + pad.x + leftW + px(18);
  const rightW = W - pad.x * 2 - leftW - px(18);
  const t = e.exhibition ? PL.now : time(e.first);
  const [hh, mm] = t.includes(':') ? t.split(':') : [t, ''];
  const bigSize = px(104);
  const titleSize = px(e.title.length > 28 ? 40 : 52);
  const desc = describe(e.description, 'short', 220);
  const evening = !e.exhibition && Number(t.slice(0, 2)) >= 18;

  const headH = px(10) * 1.4 + px(10);
  const leftH = mm ? bigSize * 1.7 : bigSize * 0.9;
  const titleH = s.measure(e.title, { size: titleSize, weight: 'x', upper: true, width: rightW, lh: 0.95, track: -0.02 });
  const metaH = s.measure(metaLine(e), { size: px(10), weight: 'b', track: 0.18, upper: true, width: rightW }) + px(12);
  const descH = desc ? s.measure(desc, { size: px(14), lh: 1.45, width: rightW }) + px(8) : 0;
  const h = pad.y * 2 + headH + Math.max(leftH, titleH + metaH + descH + px(8));

  s.ensure(h, () => undefined);
  const top = s.y;
  s.fill(X0, top, W, h, C.accent);
  const inner = X0 + pad.x;
  let y = top + pad.y;
  s.text(evening ? AFISZKA.hero : AFISZKA.heroDay, inner, y, {
    size: px(10), weight: 'b', track: 0.2, upper: true, color: C.bg, width: W - pad.x * 2,
  });
  if (e.pick) {
    s.text(pickReasonLabel(e.pick), inner, y, {
      size: px(10), weight: 'b', track: 0.2, upper: true, color: C.bg, width: W - pad.x * 2, align: 'right',
    });
  }
  y += headH;
  s.text(hh!, inner, y - bigSize * 0.12, { size: bigSize, weight: 'x', track: -0.045, color: C.bg, tnum: true, width: leftW });
  if (mm) s.text(mm, inner, y + bigSize * 0.72, { size: bigSize, weight: 'x', track: -0.045, color: C.bg, tnum: true, width: leftW });

  let ry = y;
  ry += s.text(e.title, rightX, ry, {
    size: titleSize, weight: 'x', upper: true, width: rightW, lh: 0.95, track: -0.02, color: C.bg, link: e.url,
  });
  ry += px(8);
  s.rule(ry, px(2), C.bg, rightX, rightW);
  s.text(metaLine(e), rightX, ry + px(6), { size: px(10), weight: 'b', track: 0.18, upper: true, color: C.bg, width: rightW });
  ry += metaH;
  s.rule(ry - px(2), px(2), C.bg, rightX, rightW);
  if (desc) s.text(desc, rightX, ry + px(8), { size: px(14), lh: 1.45, color: C.bg, width: rightW });
  s.y = top + h + px(12);
}

function listHeader(s: Sheet, title: string, note: string, star = false): void {
  const size = px(18);
  const top = s.y + px(6);
  const tw = s.text(title, X0, top, { size, weight: 'x', upper: true, track: -0.02 });
  if (star) {
    s.doc.font('x').fontSize(size);
    const w = s.doc.widthOfString(upper(title), { characterSpacing: -0.02 * size });
    s.star(X0 + w + size * 0.55, top + size * 0.5, size * 0.38, C.accent);
  }
  s.text(note, X0, top + px(5), { size: px(10), weight: 'b', track: 0.18, upper: true, align: 'right' });
  s.y = top + tw + px(4);
  s.rule(s.y, px(2), C.text);
  s.y += px(2);
}

interface FrontRowOpts {
  state?: string | null;
  urgent?: boolean;
  metaColor?: string;
}

function frontRowHeight(s: Sheet, issue: AfiszkaIssue, e: AfiszkaEntry, o: FrontRowOpts): number {
  const textW = W - px(112) - px(18);
  const desc = describe(e.description, 'short');
  const extra = frontExtra(issue, e);
  let h = px(8) * 2;
  if (o.state) h += s.measure(o.state, { size: px(9), weight: 'b', track: 0.16, upper: true, width: textW }) + px(2);
  h += s.measure(e.title, { size: px(16), weight: 'b', width: textW, lh: 1.12 }) + px(3);
  h += s.measure(metaLine(e), { size: px(10), weight: 'b', track: 0.18, upper: true, width: textW }) + px(3);
  if (extra) h += s.measure(extra, { size: px(10), lh: 1.4, width: textW }) + px(2);
  if (desc) h += s.measure(desc, { size: px(10), lh: 1.4, width: Math.min(textW, px(380)) });
  return Math.max(h, px(8) * 2 + px(38) * 0.9 + px(14));
}

function frontExtra(issue: AfiszkaIssue, e: AfiszkaEntry): string {
  if (e.exhibition) return runLabel(e, issue.now, issue.days);
  return issue.kind === 'outlook' ? dateRun(e.occurrences) : '';
}

function frontRow(s: Sheet, issue: AfiszkaIssue, e: AfiszkaEntry, last: boolean, o: FrontRowOpts, cont: () => void): void {
  const h = frontRowHeight(s, issue, e, o);
  s.ensure(h, cont);
  const top = s.y;
  const textX = X0 + px(112) + px(18);
  const textW = W - px(112) - px(18);
  const when = frontWhen(issue, e);
  const bigSize = when.big.length > 5 ? px(28) : px(38);
  s.text(when.big, X0, top + px(8), { size: bigSize, weight: 'x', track: -0.04, tnum: true, width: px(112), lh: 0.95 });
  if (when.small) {
    s.text(when.small, X0, top + px(8) + bigSize * 0.95 + px(3), {
      size: px(9), weight: 'b', track: 0.16, upper: true, color: C.accent700, width: px(112),
    });
  }
  let y = top + px(8);
  if (o.state) {
    y += s.text(o.state, textX, y, {
      size: px(9), weight: 'b', track: 0.16, upper: true, width: textW, color: o.urgent ? C.accent : C.text,
    }) + px(2);
  }
  y += s.text(e.title, textX, y, { size: px(16), weight: 'b', width: textW, lh: 1.12, link: e.url }) + px(3);
  y += s.text(metaLine(e), textX, y, {
    size: px(10), weight: 'b', track: 0.18, upper: true, width: textW, color: o.metaColor ?? C.accent700,
  }) + px(3);
  const extra = frontExtra(issue, e);
  if (extra) y += s.text(extra, textX, y, { size: px(10), lh: 1.4, width: textW, color: C.n700 }) + px(2);
  const desc = describe(e.description, 'short');
  if (desc) s.text(desc, textX, y, { size: px(10), lh: 1.4, width: Math.min(textW, px(380)) });
  s.y = top + h;
  s.rule(s.y - (last ? px(2) : px(1)), last ? px(2) : px(1), last ? C.divider : C.n300);
}

function frontList(
  s: Sheet, issue: AfiszkaIssue, title: string, note: string,
  rows: { entry: AfiszkaEntry; opts: FrontRowOpts }[], star = false,
): void {
  if (rows.length === 0) return;
  const first = frontRowHeight(s, issue, rows[0]!.entry, rows[0]!.opts);
  s.ensure(px(40) + first, () => undefined);
  const header = () => listHeader(s, title, note, star);
  header();
  rows.forEach((r, i) => frontRow(s, issue, r.entry, i === rows.length - 1, r.opts, header));
  s.y += px(12);
}

/** Outlook: numbered contents rows, each with its section's picks. */
function contents(s: Sheet, issue: AfiszkaIssue): void {
  if (issue.sections.length === 0) return;
  s.rule(s.y, px(2), C.text);
  s.y += px(2);
  const gridX = X0 + px(42);
  const colW = (W - px(42)) / 3;
  issue.sections.forEach((sec, i) => {
    const rowsOfPicks = Math.ceil(sec.picks.length / 3);
    const pickH = sec.picks.reduce((m, p) => Math.max(m, pickCellHeight(s, p, colW)), 0);
    const h = px(12) + px(30) * 0.95 + (rowsOfPicks ? px(10) + rowsOfPicks * (pickH + px(10)) : 0) + px(12);
    s.ensure(h, () => undefined);
    const top = s.y;
    s.text(String(i + 1).padStart(2, '0'), X0, top + px(16), { size: px(14), weight: 'x', color: C.accent });
    s.text(sec.label, X0 + px(42), top + px(12), { size: px(30), weight: 'x', upper: true, track: -0.03, lh: 0.95, width: W - px(42) - px(200) });
    s.text(sec.reason, X0, top + px(20), {
      size: px(10), weight: 'b', track: 0.18, upper: true, color: C.accent700, align: 'right', width: W - px(80),
    });
    s.refs.push({ page: s.page, y: top + px(20), section: i });
    let y = top + px(12) + px(30) * 0.95 + px(10);
    sec.picks.forEach((p, k) => {
      const col = k % 3;
      if (k > 0 && col === 0) y += pickH + px(10);
      pickCell(s, p, gridX + col * colW, y, colW - px(18));
    });
    s.y = top + h;
    const last = i === issue.sections.length - 1;
    s.rule(s.y - (last ? px(2) : px(1)), last ? px(2) : px(1), last ? C.divider : C.n300);
  });
  s.y += px(12);
}

function pickCellHeight(s: Sheet, p: AfiszkaEntry, w: number): number {
  const tw = w - px(44);
  return s.measure(p.title, { size: px(13), weight: 'b', width: tw, lh: 1.15 }) + px(3)
    + s.measure(pickMeta(p), { size: px(9), weight: 'b', track: 0.16, upper: true, width: tw });
}

function pickMeta(p: AfiszkaEntry): string {
  return [weekday(p.first), p.venue, p.exhibition ? '' : time(p.first)].filter(Boolean).join(' · ');
}

function pickCell(s: Sheet, p: AfiszkaEntry, x: number, y: number, w: number): void {
  const day = p.pick?.kind === 'opening' ? p.pick.at : p.first;
  s.text(dayNumber(day), x, y - px(3), { size: px(22), weight: 'x', track: -0.03, tnum: true, width: px(34) });
  const tx = x + px(44);
  const tw = w - px(44);
  const th = s.text(p.title, tx, y, { size: px(13), weight: 'b', width: tw, lh: 1.15, link: p.url });
  s.text(pickMeta(p), tx, y + th + px(3), { size: px(9), weight: 'b', track: 0.16, upper: true, width: tw, color: C.n700 });
}

function closingSoon(s: Sheet, issue: AfiszkaIssue): void {
  if (issue.closingSoon.length === 0) return;
  const pad = { x: px(22), y: px(16) };
  const colW = (W - pad.x * 2) / 3;
  const cellH = (e: AfiszkaEntry) => {
    const w = colW - px(28);
    const desc = describe(e.description, 'short', 120);
    return px(64) * 0.8 + px(4) + px(12)
      + s.measure(e.title, { size: px(17), weight: 'x', upper: true, width: w, lh: 1.1 }) + px(5)
      + s.measure(e.venue, { size: px(9), weight: 'b', track: 0.16, upper: true, width: w }) + px(6)
      + (desc ? s.measure(desc, { size: px(11), lh: 1.4, width: w }) : 0);
  };
  const inner = Math.max(...issue.closingSoon.map(cellH));
  const h = pad.y * 2 + px(11) * 1.4 + px(12) + inner;
  s.ensure(h + px(18), () => undefined);
  const top = s.y + px(6);
  s.fill(X0, top, W, h, C.accent);
  s.text(AFISZKA.closingSoon, X0 + pad.x, top + pad.y, { size: px(11), weight: 'b', track: 0.2, upper: true, color: C.bg });
  const y0 = top + pad.y + px(11) * 1.4 + px(12);
  issue.closingSoon.forEach((e, i) => {
    const x = X0 + pad.x + i * colW + (i === 0 ? 0 : px(14));
    const w = colW - px(28);
    if (i > 0) s.vrule(X0 + pad.x + i * colW, y0, inner, px(2), C.bg);
    let y = y0;
    s.text(dayNumber(e.run!.closes!), x, y - px(64) * 0.12, { size: px(64), weight: 'x', track: -0.05, color: C.bg, tnum: true, width: w });
    y += px(64) * 0.8 + px(4);
    y += s.text(`${monthAbbr(e.run!.closes!)} · ${AFISZKA.lastDay}`, x, y, { size: px(9), weight: 'b', track: 0.16, upper: true, color: C.bg, width: w }) + px(12);
    y += s.text(e.title, x, y, { size: px(17), weight: 'x', upper: true, width: w, lh: 1.1, color: C.bg, link: e.url }) + px(5);
    y += s.text(e.venue, x, y, { size: px(9), weight: 'b', track: 0.16, upper: true, color: C.bg, width: w }) + px(6);
    const desc = describe(e.description, 'short', 120);
    if (desc) s.text(desc, x, y, { size: px(11), lh: 1.4, color: C.bg, width: w });
  });
  s.y = top + h + px(16);
}

function festivals(s: Sheet, issue: AfiszkaIssue): void {
  if (issue.festivals.length === 0) return;
  const header = () => listHeader(s, AFISZKA.festivals, '');
  s.ensure(px(40) + px(30), () => undefined);
  header();
  issue.festivals.forEach((f, i) => {
    const h = px(30);
    s.ensure(h, header);
    const top = s.y;
    s.doc.font('b').fontSize(px(15));
    const nameW = Math.min(s.doc.widthOfString(f.name), W - px(120));
    s.text(f.name, X0, top + px(8), { size: px(15), weight: 'b', width: W - px(120) });
    s.text(festivalSpan(f), X0 + nameW + px(12), top + px(11), {
      size: px(10), weight: 'b', track: 0.16, color: C.accent700, width: px(120),
    });
    s.y = top + h;
    const last = i === issue.festivals.length - 1;
    s.rule(s.y - (last ? px(2) : px(1)), last ? px(2) : px(1), last ? C.divider : C.n300);
  });
  s.y += px(12);
}

// ─── Listing ─────────────────────────────────────────────────────────────────

/** A section heading — and, with `scope`, the heading of the sheet it runs on
 *  to ("Teatr · Tydzień 2"). */
function sectionHeader(s: Sheet, sec: AfiszkaSection, scope: string | null): void {
  const size = px(scope ? 44 : 60);
  const top = s.y;
  const capW = px(160);
  s.doc.font('x').fontSize(size);
  const label = upper(sec.label);
  const labelW = Math.min(s.doc.widthOfString(label, { characterSpacing: -0.04 * size }), W - capW);
  const h = s.text(sec.label, X0, top - size * 0.12, { size, weight: 'x', upper: true, track: -0.04, lh: 0.9, width: W - capW });
  if (scope) {
    s.text(scope, X0 + labelW + px(14), top - size * 0.12, {
      size, weight: 'x', upper: true, track: -0.04, lh: 0.9, color: C.accent, width: W - capW - labelW - px(14),
    });
  }
  const caption = [sec.count, sec.span].filter(Boolean);
  caption.forEach((line, i) => {
    s.text(line, X0 + W - capW, top + h - size * 0.12 - (caption.length - i) * px(11) * 1.5, {
      size: px(11), weight: 'b', track: 0.18, upper: true, align: 'right', width: capW,
    });
  });
  s.y = top + h - size * 0.1 + px(8);
  s.rule(s.y, px(2), C.divider);
  s.y += px(2) + px(10);
}

const CELL = {
  title: { size: px(14), weight: 'b' as Weight, lh: 1.15 },
  meta: { size: px(9), weight: 'b' as Weight, track: 0.16, upper: true },
  desc: { size: px(10), lh: 1.35 },
};

function cellWhen(issue: AfiszkaIssue, e: AfiszkaEntry, showTime: boolean): string {
  return entryWhen(e, issue.now, issue.days, showTime);
}

function refText(lead: string, e: AfiszkaEntry): string {
  return `${lead ? `${lead}  ` : ''}${e.title}  ${AFISZKA.refPdf}`;
}

function cellHeight(s: Sheet, issue: AfiszkaIssue, sec: AfiszkaSection, e: AfiszkaEntry, w: number, showTime: boolean): number {
  if (isReferenced(issue, e)) return s.measure(refText(showTime ? time(e.first) : '', e), { size: px(11), weight: 'b', width: w });
  const meta = [e.venue, cellWhen(issue, e, showTime)].filter(Boolean).join(' · ');
  const desc = describe(e.description, sec.detail);
  return (e.pick ? s.measure(pickReasonLabel(e.pick), { ...CELL.meta, width: w }) + px(2) : 0)
    + s.measure(e.title, { ...CELL.title, width: w })
    + px(4) + s.measure(meta, { ...CELL.meta, width: w }) + px(5)
    + (desc ? s.measure(desc, { ...CELL.desc, width: w }) : 0);
}

function drawRef(s: Sheet, x: number, y: number, w: number, lead: string, e: AfiszkaEntry): void {
  const doc = s.doc;
  doc.font('b').fontSize(px(11)).fillColor(C.text);
  const head = `${lead ? `${lead}  ` : ''}${e.title}  `;
  doc.text(head, x, y, { width: w, continued: true }).fillColor(C.accent700).text(AFISZKA.refPdf);
}

function drawCell(s: Sheet, issue: AfiszkaIssue, sec: AfiszkaSection, e: AfiszkaEntry, x: number, y: number, w: number, showTime: boolean): void {
  if (isReferenced(issue, e)) {
    drawRef(s, x, y, w, showTime ? time(e.first) : '', e);
    return;
  }
  if (e.pick) y += s.text(pickReasonLabel(e.pick), x, y, { ...CELL.meta, width: w, color: C.accent }) + px(2);
  y += s.text(e.title, x, y, { ...CELL.title, width: w, link: e.url }) + px(4);
  const meta = [e.venue, cellWhen(issue, e, showTime)].filter(Boolean).join(' · ');
  y += s.text(meta, x, y, { ...CELL.meta, width: w, color: C.n700 }) + px(5);
  const desc = describe(e.description, sec.detail);
  if (desc) s.text(desc, x, y, { ...CELL.desc, width: w });
}

/** Cells in a grid of `cols`, ruled between columns, paginated by row. */
function cellGrid(
  s: Sheet, issue: AfiszkaIssue, sec: AfiszkaSection, cells: AfiszkaEntry[], cols: number,
  x0: number, w: number, showTime: boolean, cont: () => void,
): void {
  const colW = w / cols;
  for (let i = 0; i < cells.length; i += cols) {
    const row = cells.slice(i, i + cols);
    const h = Math.max(...row.map((e) => cellHeight(s, issue, sec, e, colW - px(24), showTime)));
    s.ensure(h + px(12), cont);
    const top = s.y;
    row.forEach((e, k) => {
      const x = x0 + k * colW;
      s.vrule(x, top, h, px(1), C.n300);
      drawCell(s, issue, sec, e, x + px(12), top, colW - px(24), showTime);
    });
    s.y = top + h + px(12);
  }
}

function drawBlock(s: Sheet, issue: AfiszkaIssue, sec: AfiszkaSection, b: AfiszkaBlock): void {
  if (b.kind === 'bands') {
    const railW = px(104);
    const gx = X0 + railW + px(18);
    const gw = W - railW - px(18);
    const colW = gw / 3;
    for (const band of b.bands) {
      const cellH = Math.max(...band.cells.map((e) => cellHeight(s, issue, sec, e, colW - px(24), false)));
      const h = Math.max(cellH, px(32) * 0.9 + px(5) + px(12)) + px(22);
      s.ensure(h, () => sectionHeader(s, sec, band.time));
      const top = s.y;
      s.text(band.time, X0, top + px(11) - px(3), { size: px(32), weight: 'x', track: -0.035, tnum: true, width: railW });
      s.text(band.label, X0, top + px(11) + px(32) * 0.9 + px(5), {
        size: px(9), weight: 'b', track: 0.16, upper: true, color: C.accent700, width: railW,
      });
      band.cells.forEach((e, k) => {
        const x = gx + k * colW;
        s.vrule(x, top + px(11), cellH, px(1), C.n300);
        drawCell(s, issue, sec, e, x + px(12), top + px(11), colW - px(24), false);
      });
      s.y = top + h;
      s.rule(s.y - px(1), px(1), C.n300);
    }
    return;
  }
  if (b.kind === 'parts') {
    for (const part of b.parts) {
      const cont = () => sectionHeader(s, sec, part.label);
      const cols = part.allDay ? 2 : 3;
      const firstH = cellHeight(s, issue, sec, part.cells[0]!, W / cols - px(24), !part.allDay);
      s.ensure(px(34) + firstH, cont);
      const top = s.y + px(6);
      const lw = s.text(part.label, X0, top, { size: px(18), weight: 'x', upper: true, track: -0.01 });
      s.doc.font('x').fontSize(px(18));
      const labelW = s.doc.widthOfString(upper(part.label), { characterSpacing: -0.01 * px(18) });
      if (part.range) s.text(part.range, X0 + labelW + px(10), top + px(5), { size: px(10), weight: 'b', track: 0.12, color: C.n700, width: px(120) });
      s.text(String(part.cells.length), X0, top + px(5), { size: px(10), weight: 'b', track: 0.12, color: C.accent, align: 'right' });
      s.y = top + lw + px(4);
      s.rule(s.y, px(1), C.n300);
      s.y += px(10);
      cellGrid(s, issue, sec, part.cells, cols, X0 - px(12), W + px(12), !part.allDay, cont);
    }
    return;
  }
  if (b.kind === 'weeks') {
    for (const week of b.weeks) {
      const scope = `${week.label}`;
      const header = () => {
        const top = s.y + px(8);
        s.doc.font('x').fontSize(px(18));
        const lw = s.doc.widthOfString(upper(week.label), { characterSpacing: -0.01 * px(18) });
        const h = s.text(week.label, X0, top, { size: px(18), weight: 'x', upper: true, track: -0.01 });
        s.text(week.span, X0 + lw + px(10), top, { size: px(18), weight: 'x', upper: true, color: C.accent, width: px(200) });
        s.y = top + h + px(4);
        s.rule(s.y, px(2), C.text);
        s.y += px(2);
      };
      s.ensure(px(40) + weekRowHeight(s, issue, sec, week.entries[0]!), () => sectionHeader(s, sec, scope));
      header();
      for (const e of week.entries) weekRow(s, issue, sec, e, () => { sectionHeader(s, sec, scope); header(); });
      s.y += px(8);
    }
    return;
  }
  if (b.kind === 'venues') {
    for (const v of b.venues) {
      const cont = () => sectionHeader(s, sec, v.name);
      const firstH = cellHeight(s, issue, sec, { ...v.entries[0]!, venue: '' }, W / 3 - px(24), true);
      s.ensure(px(34) + firstH, cont);
      const top = s.y + px(6);
      const h = s.text(v.name, X0, top, { size: px(18), weight: 'x', upper: true, track: -0.01, width: W - px(60) });
      s.text(String(v.entries.length), X0, top + px(5), { size: px(10), weight: 'b', track: 0.12, color: C.accent, align: 'right' });
      s.y = top + h + px(4);
      s.rule(s.y, px(1), C.n300);
      s.y += px(10);
      // The venue is the heading; repeating it in every cell is noise (§2.2).
      const cells = v.entries.map((e) => ({ ...e, venue: '' }));
      cellGrid(s, issue, sec, cells, 3, X0 - px(12), W + px(12), true, cont);
    }
    return;
  }
  timeline(s, issue, sec, b);
}

const WEEK = { dateW: px(76), tagW: px(90) };

function weekRowHeight(s: Sheet, issue: AfiszkaIssue, sec: AfiszkaSection, e: AfiszkaEntry): number {
  const w = W - WEEK.dateW - px(18) - WEEK.tagW;
  if (isReferenced(issue, e)) return px(10) * 2 + Math.max(px(38) * 0.85 + px(14), s.measure(refText(time(e.first), e), { size: px(11), weight: 'b', width: w }));
  const desc = describe(e.description, sec.detail);
  const h = s.measure(e.title, { size: px(16), weight: 'b', width: w, lh: 1.12 }) + px(4)
    + s.measure(e.venue, { size: px(9), weight: 'b', track: 0.16, upper: true, width: w }) + px(3)
    + s.measure(dateRun(e.occurrences), { size: px(10), lh: 1.4, width: w }) + px(3)
    + (desc ? s.measure(desc, { size: px(11), lh: 1.4, width: w }) : 0);
  return px(10) * 2 + Math.max(h, px(38) * 0.85 + px(14));
}

function weekRow(s: Sheet, issue: AfiszkaIssue, sec: AfiszkaSection, e: AfiszkaEntry, cont: () => void): void {
  const h = weekRowHeight(s, issue, sec, e);
  s.ensure(h, cont);
  const top = s.y;
  const x = X0 + WEEK.dateW + px(18);
  const w = W - WEEK.dateW - px(18) - WEEK.tagW;
  s.text(dayNumber(e.first), X0, top + px(10) - px(3), { size: px(38), weight: 'x', track: -0.04, tnum: true, width: WEEK.dateW });
  s.text(`${weekday(e.first)} · ${monthAbbr(e.first)}`, X0, top + px(10) + px(38) * 0.85 + px(3), {
    size: px(9), weight: 'b', track: 0.16, upper: true, color: C.accent700, width: WEEK.dateW,
  });
  let y = top + px(10);
  if (isReferenced(issue, e)) {
    drawRef(s, x, y + px(4), w, time(e.first), e);
  } else {
    y += s.text(e.title, x, y, { size: px(16), weight: 'b', width: w, lh: 1.12, link: e.url }) + px(4);
    y += s.text(e.venue, x, y, { size: px(9), weight: 'b', track: 0.16, upper: true, color: C.n700, width: w }) + px(3);
    y += s.text(dateRun(e.occurrences), x, y, { size: px(10), lh: 1.4, width: w, color: C.n700 }) + px(3);
    const desc = describe(e.description, sec.detail);
    if (desc) s.text(desc, x, y, { size: px(11), lh: 1.4, width: w });
    if (e.pick) {
      const tag = pickReasonLabel(e.pick);
      const th = px(9) * 1.2 + px(6);
      s.fill(X0 + W - WEEK.tagW + px(6), top + px(10), WEEK.tagW - px(6), th, C.accent100);
      s.text(tag, X0 + W - WEEK.tagW + px(6), top + px(10) + px(3), {
        size: px(9), weight: 'b', track: 0.14, upper: true, color: C.accent700, width: WEEK.tagW - px(6), align: 'center',
      });
    }
  }
  s.y = top + h;
  s.rule(s.y - px(1), px(1), C.n300);
}

function timeline(s: Sheet, issue: AfiszkaIssue, sec: AfiszkaSection, b: Extract<AfiszkaBlock, { kind: 'timeline' }>): void {
  const labelW = px(200);
  const gx = X0 + labelW;
  const gw = W - labelW;
  const n = b.days.length;
  const dayW = gw / n;
  const head = () => {
    const top = s.y + px(8);
    const h = s.text(AFISZKA.timeline, X0, top, { size: px(18), weight: 'x', upper: true, track: -0.01 });
    s.y = top + h + px(4);
    s.rule(s.y, px(2), C.text);
    s.y += px(6);
    b.days.forEach((d, i) => {
      const weekend = ['SB', 'ND'].includes(weekday(d));
      s.text(dayNumber(d), gx + i * dayW, s.y, {
        size: px(n > 16 ? 7 : 9), weight: 'b', align: 'center', width: dayW, tnum: true,
        color: weekend ? C.accent700 : C.n700,
      });
    });
    s.y += px(14);
    s.rule(s.y, px(1), C.n300);
  };
  const rowH = (e: AfiszkaEntry) => {
    if (isReferenced(issue, e)) return px(10) * 2 + s.measure(refText('', e), { size: px(11), weight: 'b', width: W });
    const desc = describe(e.description, sec.detail);
    return px(10) * 2
      + Math.max(
        s.measure(e.title, { size: px(13), weight: 'b', width: labelW - px(14), lh: 1.15 }) + px(3)
          + s.measure(e.venue, { size: px(9), weight: 'b', track: 0.16, upper: true, width: labelW - px(14) }),
        px(20),
      )
      + (desc ? px(6) + s.measure(desc, { size: px(11), lh: 1.4, width: W }) : 0);
  };
  s.ensure(px(60) + rowH(b.rows[0]!), () => sectionHeader(s, sec, AFISZKA.timeline));
  head();
  for (const e of b.rows) {
    const h = rowH(e);
    s.ensure(h, () => { sectionHeader(s, sec, AFISZKA.timeline); head(); });
    const top = s.y;
    if (isReferenced(issue, e)) {
      drawRef(s, X0, top + px(10), W, '', e);
    } else {
      let ly = top + px(10);
      ly += s.text(e.title, X0, ly, { size: px(13), weight: 'b', width: labelW - px(14), lh: 1.15, link: e.url }) + px(3);
      ly += s.text(e.venue, X0, ly, { size: px(9), weight: 'b', track: 0.16, upper: true, color: C.n700, width: labelW - px(14) });
      const { from, to } = barSpan(e, b.days);
      const barY = top + px(16);
      s.fill(gx + from * dayW, barY, (to - from + 1) * dayW, px(2), C.accent);
      s.text(runLabel(e, issue.now, n), gx + from * dayW, barY + px(5), {
        size: px(9), weight: 'b', track: 0.16, upper: true, color: C.accent700, width: Math.max((to - from + 1) * dayW, px(140)),
      });
      const desc = describe(e.description, sec.detail);
      if (desc) {
        const dy = Math.max(ly, barY + px(20)) + px(6);
        s.text(desc, X0, dy, { size: px(11), lh: 1.4, width: W });
      }
    }
    s.y = top + h;
    s.rule(s.y - px(1), px(1), C.n300);
  }
  s.y += px(8);
}

function listing(s: Sheet, issue: AfiszkaIssue): void {
  issue.sections.forEach((sec, i) => {
    // Each section opens a sheet of its own — except a small one, which joins
    // the sheet before it as its own block when it fits (§3.3).
    const small = sec.entries.length <= 3;
    if (!(small && s.page > 0 && s.y + px(220) <= LIMIT)) s.newPage();
    else s.y += px(18);
    s.markSection(i);
    sectionHeader(s, sec, null);
    const before = s.page;
    for (const b of sec.blocks) drawBlock(s, issue, sec, b);
    if (s.page !== before) s.markSection(i);
  });
}

function footers(s: Sheet): void {
  const range = s.doc.bufferedPageRange();
  const total = range.count;
  for (let i = 0; i < total; i++) {
    s.doc.switchToPage(range.start + i);
    const y = PAGE.height - PAD.bottom - px(10);
    s.rule(y - px(10), px(2), C.divider);
    s.text(`${AFISZKA.wordmark.head}.${AFISZKA.wordmark.tail} · ${SITE}`, X0, y, {
      size: px(10), weight: 'b', track: 0.18, upper: true, color: C.n700, width: W / 2,
    });
    s.text(AFISZKA.sheetOf(i + 1, total), X0 + W / 2, y, {
      size: px(10), weight: 'b', track: 0.18, upper: true, color: C.n700, width: W / 2, align: 'right',
    });
  }
}

/** The contents rows' sheet references, now that every section has landed. */
function contentRefs(s: Sheet): void {
  const range = s.doc.bufferedPageRange();
  for (const ref of s.refs) {
    const span = s.spans.get(ref.section);
    if (!span) continue;
    s.doc.switchToPage(range.start + ref.page);
    s.text(AFISZKA.sheets(span.from, span.to), X0 + W - px(72), ref.y, {
      size: px(10), weight: 'b', track: 0.18, upper: true, align: 'right', width: px(72),
    });
  }
}

export function renderAfiszkaPdf(content: AfiszkaContent): Promise<Buffer> {
  const issue = buildAfiszkaIssue(content);
  const doc: PDFKit.PDFDocument = new PDFDocument({
    size: [PAGE.width, PAGE.height],
    margin: 0,
    bufferPages: true,
    autoFirstPage: true,
    info: {
      Title: `${AFISZKA.wordmark.head}.${AFISZKA.wordmark.tail} — ${PL.city}`,
      Author: 'AFISZ',
      Creator: 'AFISZ',
      CreationDate: issue.now,
    },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  for (const w of ['r', 'b', 'x'] as const) doc.registerFont(w, loadFont(FILES[w]));

  const s = new Sheet(doc);
  s.fill(0, 0, PAGE.width, PAGE.height, C.bg);

  masthead(s, issue);
  factBand(s, issue);
  if (issue.kind === 'daily') {
    if (issue.hero) hero(s, issue, issue.hero);
    frontList(s, issue, AFISZKA.morePicks, AFISZKA.morePicksNote,
      issue.morePicks.map((e) => ({ entry: e, opts: { state: e.pick ? pickReasonLabel(e.pick) : null, urgent: true } })));
  } else {
    contents(s, issue);
    closingSoon(s, issue);
  }
  frontList(s, issue, AFISZKA.wantToGo,
    issue.kind === 'daily' ? AFISZKA.wantToGoNote.daily : AFISZKA.wantToGoNote.other,
    issue.saved.map((v) => ({ entry: v.entry, opts: { state: v.state, urgent: v.urgent, metaColor: C.n700 } })),
    true);
  festivals(s, issue);
  if (issue.empty) {
    s.y += s.text(AFISZKA.nothing, X0, s.y + px(8), { size: px(13), color: C.n700 });
  }

  listing(s, issue);
  contentRefs(s);
  footers(s);

  doc.end();
  return done;
}
