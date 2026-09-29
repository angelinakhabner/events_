import { createRequire } from 'node:module';
import type PDFKit from 'pdfkit';
import type { Event } from '@afisz/shared';
import type { BriefSection } from './newsletter-render.js';
import type { BriefPdfContent } from './newsletter-pdf.js';
import { env } from '../config.js';
import { PL } from './newsletter-copy.js';
import { loadFont } from './pdf-fonts.js';
import {
  dayPart, isAllDay, minutesIntoDay, planPoster,
  type DayPart, type ListingGroup, type PosterCategory, type PosterPlan,
} from './newsletter-poster.js';

/**
 * The daily issue as a printable poster: the "AFISZ.KA Daily" handoff, drawn
 * with pdfkit.
 *
 * The handoff suggests a headless browser, and this deliberately is not one —
 * for the reason `newsletter-pdf.ts` gives: a ~300MB dependency and a
 * seconds-long cold start on a service that answers small queries. pdfkit
 * measures text with the same font it embeds, so the pagination the handoff
 * asks for ("measure at render time, don't estimate by character count") is
 * done here from real line breaks.
 *
 * Everything below is written in the design's CSS pixels (an A4 page is
 * 794 × 1123 at 96dpi) and converted to points in one place, so the numbers in
 * this file can be read straight against the design's inline styles.
 * Line heights follow CSS: a line box of `size × line-height` with the glyphs
 * centred in it, which is what makes an 82px wordmark at line-height 0.82 sit
 * where the design puts it.
 */

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PDFDocument = require('pdfkit') as any;

const TZ = 'Europe/Warsaw';

// ─── Geometry ────────────────────────────────────────────────────────────────

const PAGE_PT = { width: 595.28, height: 841.89 };
const PAGE = { width: 794, height: 1123 };
/** Points per CSS pixel. */
const K = PAGE_PT.width / PAGE.width;
const PAD = { top: 44, side: 46, bottom: 34 };
const LEFT = PAD.side;
const WIDTH = PAGE.width - PAD.side * 2;
const BOTTOM = PAGE.height - PAD.bottom;

/** Modernist tokens. The divider is 40% ink, pre-blended over the page. */
const C = {
  bg: '#f3f2f2',
  text: '#201e1d',
  accent: '#ec3013',
  divider: '#9f9d9d',
  n300: '#d7d3d3',
  n700: '#605d5d',
  a100: '#fff2ef',
  a700: '#ae1800',
} as const;

const FONT_FILES = {
  regular: 'Archivo-Regular.subset.ttf',
  semibold: 'Archivo-SemiBold.subset.ttf',
  bold: 'Archivo-Bold.subset.ttf',
  heavy: 'Archivo-ExtraBold.subset.ttf',
} as const;
type Face = keyof typeof FONT_FILES;

// ─── Text ────────────────────────────────────────────────────────────────────

/** Punctuation a clamp drops before its ellipsis, so it never reads ",…". */
const TRAILING = /[\s,.;:·|—–-]+$/;

/** Joined with no-break spaces, so a label never splits across lines. */
const A_PICK = 'A\u00a0pick';
const FREE_ENTRY = 'Free\u00a0entry';

interface Style {
  face: Face;
  size: number;
  /** CSS line-height, as a multiplier. */
  lh: number;
  color?: string;
  /** CSS letter-spacing, in em. */
  track?: number;
  upper?: boolean;
  tnum?: boolean;
}

type Doc = PDFKit.PDFDocument;

/** A CSS-positioned text engine over one pdfkit document. */
class Typesetter {
  /** The font's ascent and content height, per em — the same for every
   *  Archivo weight, read off the regular. */
  private ascent = 0.878;
  private content = 1.088;

  constructor(readonly doc: Doc) {
    for (const [face, file] of Object.entries(FONT_FILES)) {
      doc.registerFont(face, loadFont(file));
    }
    doc.font('regular').fontSize(100);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const font = (doc as any)._font as { ascender: number; descender: number };
    this.ascent = font.ascender / 1000;
    this.content = (font.ascender - font.descender) / 1000;
  }

  private apply(style: Style): void {
    this.doc.font(style.face).fontSize(style.size * K);
  }

  private options(style: Style, width: number): PDFKit.Mixins.TextOptions {
    return {
      width: width * K,
      characterSpacing: (style.track ?? 0) * style.size * K,
      lineGap: (style.lh - this.content) * style.size * K,
      features: style.tnum ? ['tnum'] : [],
      height: 1e6,
    } as PDFKit.Mixins.TextOptions;
  }

  private cased(text: string, style: Style): string {
    return style.upper ? text.toLocaleUpperCase('pl-PL') : text;
  }

  /** Distance from a line box's top to its baseline, in px. */
  baseline(style: Pick<Style, 'size' | 'lh'>): number {
    return ((style.lh - this.content) / 2 + this.ascent) * style.size;
  }

  /** The unwrapped width of `text`, in px. */
  width(text: string, style: Style): number {
    this.apply(style);
    return this.doc.widthOfString(this.cased(text, style), {
      characterSpacing: (style.track ?? 0) * style.size * K,
      features: style.tnum ? ['tnum'] : [],
    } as PDFKit.Mixins.TextOptions) / K;
  }

  /** How many lines `text` wraps to at `width`. */
  lines(text: string, style: Style, width: number): number {
    if (!text) return 0;
    this.apply(style);
    const opts = this.options(style, width);
    const h = this.doc.heightOfString(this.cased(text, style), opts);
    const per = this.doc.currentLineHeight(true) + (opts.lineGap ?? 0);
    return Math.max(1, Math.round(h / per));
  }

  /**
   * `text` cut to `max` lines with an ellipsis — the design's line clamp.
   * Binary search on words, so it is the real wrap that decides, not a
   * character count. A source that already ends in "…" keeps it.
   */
  clamp(text: string, style: Style, width: number, max: number): string {
    if (this.lines(text, style, width) <= max) return text;
    const words = text.split(' ');
    let lo = 0;
    let hi = words.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const candidate = `${words.slice(0, mid).join(' ').replace(TRAILING, '')}…`;
      if (this.lines(candidate, style, width) <= max) lo = mid;
      else hi = mid - 1;
    }
    return `${words.slice(0, Math.max(lo, 1)).join(' ').replace(TRAILING, '')}…`;
  }

  /** Height of `text` as a CSS block of `width`, in px. */
  height(text: string, style: Style, width: number): number {
    return this.lines(text, style, width) * style.lh * style.size;
  }

  /** Draw `text` as a CSS block whose top is `y`. Returns its height. */
  draw(
    text: string,
    style: Style,
    x: number,
    y: number,
    width: number,
    extra: { align?: 'left' | 'right'; link?: string | null } = {},
  ): number {
    if (!text) return 0;
    const lines = this.lines(text, style, width);
    this.apply(style);
    const halfLeading = ((style.lh - this.content) / 2) * style.size;
    this.doc.fillColor(style.color ?? C.text).text(
      this.cased(text, style),
      x * K,
      (y + halfLeading) * K,
      {
        ...this.options(style, width),
        align: extra.align ?? 'left',
        ...(extra.link ? { link: extra.link } : {}),
      },
    );
    return lines * style.lh * style.size;
  }
}

// ─── Blocks ──────────────────────────────────────────────────────────────────

/** Something measured before it is placed: the paginator reads `height`, and
 *  `draw` runs once the page and its position are known. */
interface Block {
  height: number;
  draw(y: number): void;
}

function rect(doc: Doc, x: number, y: number, w: number, h: number, color: string): void {
  doc.save().rect(x * K, y * K, w * K, h * K).fill(color).restore();
}

/** A five-point star. Archivo has no ★, and a fallback font for one glyph
 *  would be a 20KB embed for a decoration. */
function star(doc: Doc, cx: number, baselineY: number, size: number, color: string): void {
  const r = size * 0.42;
  const cy = baselineY - r * 0.95;
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.45;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push([(cx + radius * Math.cos(angle)) * K, (cy + radius * Math.sin(angle)) * K]);
  }
  doc.save().polygon(...pts).fill(color).restore();
}

function flat(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function clock(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

function venueName(e: Event): string {
  return e.venue?.name ?? '';
}

function isFree(e: Event): boolean {
  return e.priceMin === 0 && (e.priceMax == null || e.priceMax === 0);
}

const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

function places(n: number): string {
  return `${NUMBER_WORDS[n] ?? n} ${n === 1 ? 'place' : 'places'}`;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ─── Context ─────────────────────────────────────────────────────────────────

interface Ctx {
  doc: Doc;
  t: Typesetter;
  plan: PosterPlan;
}

/** The label under a category's name — "Cinema · Kino Muranów". */
function metaLine(ctx: Ctx, e: Event): string {
  const label = ctx.plan.categoryOf.get(e.id)?.label;
  return [label, venueName(e)].filter(Boolean).join(' · ');
}

// ─── Sheet 1: the front ──────────────────────────────────────────────────────

const LABEL: Style = { face: 'semibold', size: 11, lh: 1.55, track: 0.16, upper: true };
const CAPTION: Style = { face: 'semibold', size: 10, lh: 1.55, track: 0.18, upper: true };

function masthead(ctx: Ctx, issueNo: number | null | undefined): Block {
  const { t, doc } = ctx;
  const mark: Style = { face: 'heavy', size: 82, lh: 0.82, track: -0.045, upper: true };
  const side: Style = { face: 'semibold', size: 11, lh: 1.5, track: 0.18, upper: true };
  const sideLines = ['Daily', ...(issueNo ? [`No. ${issueNo}`] : []), 'afisz.cc'];
  const markH = 82 * 0.82;
  const sideH = sideLines.length * 11 * 1.5 + 6;
  const rowH = Math.max(markH, sideH);
  return {
    height: rowH + 10 + 2,
    draw(y) {
      // Set as one run so the kerning holds, then the dot is struck again in
      // the accent exactly over itself.
      const top = y + rowH - markH;
      t.draw('AFISZ.KA', mark, LEFT, top, WIDTH);
      const dotX = LEFT + t.width('AFISZ.', mark) - t.width('.', mark);
      t.draw('.', { ...mark, color: C.accent }, dotX, top, 100);
      let sy = y + rowH - sideH;
      for (const line of sideLines) {
        sy += t.draw(line, side, LEFT, sy, WIDTH, { align: 'right' });
      }
      rect(doc, LEFT, y + rowH + 10, WIDTH, 2, C.divider);
    },
  };
}

function factBand(ctx: Ctx, now: Date): Block {
  const { t, doc, plan } = ctx;
  const value: Style = { face: 'heavy', size: 20, lh: 1.55, track: -0.01, upper: true };
  const fmt = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...o }).format(now);
  const cells: [string, string][] = [
    [fmt({ weekday: 'long' }), fmt({ day: 'numeric', month: 'short', year: 'numeric' })],
    ['City', PL.city],
    ['Your day', count(plan.eventCount, 'event', 'events')],
    ['Across', count(plan.placeCount, 'place', 'places')],
  ];
  const colW = WIDTH / 4;
  const inner = (i: number) => colW - (i === 0 || i === 3 ? 12 : 24) - (i === 0 ? 0 : 2);
  const heights = cells.map(([label, v], i) =>
    t.height(label, LABEL, inner(i)) + t.height(v, value, inner(i)));
  const h = 10 + Math.max(...heights) + 10;
  return {
    height: h + 2,
    draw(y) {
      cells.forEach(([label, v], i) => {
        const colX = LEFT + colW * i;
        if (i > 0) rect(doc, colX, y, 2, h, C.divider);
        const x = colX + (i === 0 ? 0 : 2 + 12);
        const ly = y + 10;
        const vy = ly + t.draw(label, LABEL, x, ly, inner(i));
        t.draw(v, value, x, vy, inner(i));
      });
      rect(doc, LEFT, y + h, WIDTH, 2, C.divider);
    },
  };
}

function dedication(ctx: Ctx, name: string | null): Block {
  const style: Style = { face: 'semibold', size: 12, lh: 1.55, track: 0.14, upper: true, color: C.a700 };
  const text = name
    ? `For ${name} — picked from the places you follow`
    : 'Picked from the places you follow';
  const h = ctx.t.height(text, style, WIDTH);
  return {
    height: 8 + h + 14,
    draw(y) { ctx.t.draw(text, style, LEFT, y + 8, WIDTH); },
  };
}

/** Tonight's one: the accent field at the top of the front. */
function hero(ctx: Ctx, e: Event, level: number): Block {
  const { t, doc, plan } = ctx;
  const inner = WIDTH - 36;
  const eyebrow: Style = { face: 'bold', size: 10, lh: 1.55, track: 0.2, upper: true, color: C.bg };
  const left = plan.heroTonight ? 'Tonight — the one' : 'Today — the one';
  const right = metaLine(ctx, e);
  const leftW = t.width(left, eyebrow);
  const rightW = inner - leftW - 20;
  const topH = Math.max(t.height(left, eyebrow, inner), t.height(right, eyebrow, rightW));

  const allDay = isAllDay(e);
  const time: Style = allDay
    ? { face: 'heavy', size: 28, lh: 0.9, track: -0.02, upper: true, color: C.bg }
    : { face: 'heavy', size: 56, lh: 0.85, track: -0.045, tnum: true, color: C.bg };
  const timeText = allDay ? 'All day' : clock(e.startsAt);
  const timeW = t.width(timeText, time) + 2;
  const timeH = time.size * time.lh;

  const desc = flat(e.description);
  const descStyle: Style = { face: 'regular', size: 12, lh: 1.4, color: C.bg };
  const descMin = desc ? 220 : 0;
  const titleMax = inner - timeW - 18 - (desc ? 18 + descMin : 0);

  // A long title wraps rather than pushing the description off the field,
  // and steps down a size when wrapping alone would stack it too tall.
  let title: Style = { face: 'heavy', size: 40, lh: 0.9, track: -0.035, upper: true, color: C.bg };
  for (const size of [40, 32, 26]) {
    title = { ...title, size };
    if (t.lines(e.title, title, titleMax) <= (size === 26 ? 99 : 2)) break;
  }
  const titleW = Math.min(t.width(e.title, title) + 2, titleMax);
  const titleH = t.height(e.title, title, titleW);

  const descX = LEFT + 18 + timeW + 18 + titleW + 18;
  const descW = LEFT + 18 + inner - descX - 16;
  const descText = desc ? t.clamp(desc, descStyle, descW, level >= 2 ? 3 : 5) : '';
  const descH = descText ? t.height(descText, descStyle, descW) : 0;
  const rowH = Math.max(timeH, titleH, descH);

  const h = 12 + topH + 2 + 6 + rowH + 14;
  return {
    height: h,
    draw(y) {
      rect(doc, LEFT, y, WIDTH, h, C.accent);
      const x0 = LEFT + 18;
      t.draw(left, eyebrow, x0, y + 12, inner);
      t.draw(right, eyebrow, x0 + inner - rightW, y + 12, rightW, { align: 'right' });
      const ry = y + 12 + topH + 2 + 6;
      t.draw(timeText, time, x0, ry + (rowH - timeH) / 2, timeW + 4);
      t.draw(e.title, title, x0 + timeW + 18, ry + (rowH - titleH) / 2, titleW, { link: e.sourceUrl });
      if (descText) {
        const dy = ry + (rowH - descH) / 2;
        rect(doc, descX, dy, 2, descH, C.bg);
        t.draw(descText, descStyle, descX + 16, dy, descW);
      }
    },
  };
}

/** "Three more for today" and "Want to go ★", which share one style. */
function frontList(
  ctx: Ctx,
  args: {
    title: string;
    star?: boolean;
    caption: string;
    events: Event[];
    metaColor: string;
    descLines: number;
    more?: string | null;
  },
): Block {
  const { t, doc } = ctx;
  const head: Style = { face: 'heavy', size: 18, lh: 1.55, track: -0.02, upper: true };
  const time: Style = { face: 'heavy', size: 38, lh: 0.85, track: -0.04, tnum: true };
  const allDayTime: Style = { face: 'heavy', size: 15, lh: 1.2, track: 0.06, upper: true };
  const titleS: Style = { face: 'bold', size: 16, lh: 1.12, track: -0.015 };
  const meta: Style = { face: 'bold', size: 10, lh: 1.55, track: 0.18, upper: true, color: args.metaColor };
  const descS: Style = { face: 'regular', size: 10, lh: 1.4 };

  const colX = LEFT + 112 + 18;
  const colW = WIDTH - 130;
  const descW = Math.min(colW, t.width('0'.repeat(52), descS));

  const headH = 18 * 1.55 + 6 + 2;
  const rows = args.events.map((e) => {
    const tStyle = isAllDay(e) ? allDayTime : time;
    const tText = isAllDay(e) ? 'All day' : clock(e.startsAt);
    const desc = args.descLines > 0 ? flat(e.description) : '';
    const descText = desc ? t.clamp(desc, descS, descW, args.descLines) : '';
    const titleH = t.height(e.title, titleS, colW);
    const metaText = metaLine(ctx, e);
    const colH = titleH + 3 + t.height(metaText, meta, colW) + (descText ? 3 + t.height(descText, descS, descW) : 0);
    // Baseline alignment, as flex does it: the item whose baseline sits
    // lowest in its own box stays put, the other is pushed down to meet it.
    const tb = t.baseline(tStyle);
    const cb = t.baseline(titleS);
    const shift = Math.max(tb, cb);
    const tTop = shift - tb;
    const cTop = shift - cb;
    const inner = Math.max(tTop + tStyle.size * tStyle.lh, cTop + colH);
    return { e, tStyle, tText, descText, titleH, metaText, tTop, cTop, h: 8 + inner + 8 };
  });
  const moreH = args.more ? 6 + CAPTION.size * CAPTION.lh : 0;
  const rowsH = rows.reduce((n, r) => n + r.h + 1, 0) + (rows.length ? 1 : 0);

  return {
    height: headH + rowsH + moreH,
    draw(y) {
      t.draw(args.title, head, LEFT, y, WIDTH);
      if (args.star) {
        const w = t.width(args.title, head);
        star(doc, LEFT + w + 12, y + t.baseline(head), 18, C.accent);
      }
      const capTop = t.baseline(head) - t.baseline(CAPTION);
      t.draw(args.caption, CAPTION, LEFT, y + capTop, WIDTH, { align: 'right' });
      rect(doc, LEFT, y + 18 * 1.55 + 6, WIDTH, 2, C.text);
      let ry = y + headH;
      rows.forEach((r, i) => {
        const top = ry + 8;
        t.draw(r.tText, r.tStyle, LEFT, top + r.tTop, 112);
        let cy = top + r.cTop;
        cy += t.draw(r.e.title, titleS, colX, cy, colW, { link: r.e.sourceUrl }) + 3;
        cy += t.draw(r.metaText, meta, colX, cy, colW);
        if (r.descText) t.draw(r.descText, descS, colX, cy + 3, descW);
        ry += r.h;
        const last = i === rows.length - 1;
        rect(doc, LEFT, ry, WIDTH, last ? 2 : 1, last ? C.divider : C.n300);
        ry += last ? 2 : 1;
      });
      if (args.more) t.draw(args.more, { ...CAPTION, color: C.n700 }, LEFT, ry + 6, WIDTH);
    },
  };
}

/**
 * The front page's blocks, trimmed until they fit one sheet. The design is
 * sized for a typical day; a day of long titles has to give something up, and
 * descriptions go before events do.
 */
function frontBlocks(ctx: Ctx, content: BriefPdfContent, now: Date): Block[] {
  const { plan } = ctx;
  const limit = BOTTOM - CAPTION.size * CAPTION.lh - 14;
  let last: Block[] = [];
  for (let level = 0; level <= 5; level++) {
    const listDesc = level === 0 ? 2 : 1;
    const savedShown = level >= 5 ? Math.min(plan.saved.length, 1) : plan.saved.length;
    const saved = plan.saved.slice(0, savedShown);
    const overflow = plan.savedOverflow + (plan.saved.length - saved.length);
    const blocks: Block[] = [
      masthead(ctx, content.issueNo),
      factBand(ctx, now),
      dedication(ctx, content.recipientName?.trim() || null),
    ];
    if (plan.hero) blocks.push(hero(ctx, plan.hero, level));
    if (plan.more.length) {
      blocks.push(gap(12), frontList(ctx, {
        title: 'Three more for today',
        caption: 'Full listing overleaf',
        events: plan.more,
        metaColor: C.a700,
        descLines: level >= 3 ? 0 : listDesc,
      }));
    }
    if (saved.length) {
      blocks.push(gap(12), frontList(ctx, {
        title: 'Want to go',
        star: true,
        caption: 'You saved these · today',
        events: saved,
        metaColor: C.n700,
        descLines: level >= 4 ? 0 : listDesc,
        more: overflow > 0 ? `+${overflow} more saved` : null,
      }));
    }
    last = blocks;
    const total = blocks.reduce((n, b) => n + b.height, PAD.top);
    if (total <= limit) break;
  }
  return last;
}

function gap(height: number): Block {
  return { height, draw() {} };
}

// ─── Listing: shared pieces ──────────────────────────────────────────────────

type Footer =
  | { kind: 'front' }
  | { kind: 'tally'; text: string }
  | { kind: 'links' };

interface Page {
  ops: (() => void)[];
  footer: Footer;
}

/** Space the listing may fill: above the footer and its padding. */
const LISTING_LIMIT = BOTTOM - CAPTION.size * CAPTION.lh - 12 - 2;

function listingHeader(
  ctx: Ctx,
  group: ListingGroup,
  caption: string[],
  cont: boolean,
): Block {
  const { t, doc } = ctx;
  const side: Style = { face: 'semibold', size: 11, lh: 1.5, track: 0.18, upper: true };
  const sideW = Math.max(...caption.map((c) => t.width(c, side))) + 4;
  const sideH = caption.length * 11 * 1.5;
  const maxW = WIDTH - sideW - 16;
  const [first, ...rest] = group.categories;
  const suffix = cont ? ' (cont.)' : '';

  // Merged categories take the two-line heading: the first as the sheet's
  // own, the rest after an ampersand in the accent.
  const lines: [string, string][] = rest.length
    ? [[first!.label + suffix, C.text], [`& ${rest.map((c) => c.label).join(', ')}`, C.accent]]
    : [[first!.label + suffix, C.text]];
  let style: Style = rest.length
    ? { face: 'heavy', size: 36, lh: 0.84, track: -0.04, upper: true }
    : { face: 'heavy', size: 60, lh: 0.82, track: -0.04, upper: true };
  // Shrink a long name (a reader's tag, a "(cont.)") to fit beside the caption.
  while (style.size > 24 && lines.some(([l]) => t.width(l, style) > maxW)) {
    style = { ...style, size: style.size - 2 };
  }
  const titleH = lines.reduce((n, [l]) => n + t.height(l, style, maxW), 0);
  const rowH = Math.max(titleH, sideH);
  return {
    height: rowH + 8 + 2,
    draw(y) {
      let ty = y + rowH - titleH;
      for (const [l, color] of lines) ty += t.draw(l, { ...style, color }, LEFT, ty, maxW);
      let sy = y + rowH - sideH;
      for (const c of caption) sy += t.draw(c, side, LEFT + WIDTH - sideW, sy, sideW, { align: 'right' });
      rect(doc, LEFT, y + rowH + 8, WIDTH, 2, C.divider);
    },
  };
}

/** "Kino Muranów 7 · Kinoteka 7 · Kino Iluzjon 1", busiest first. */
function tally(events: Event[]): string {
  const counts = new Map<string, number>();
  for (const e of events) counts.set(venueName(e), (counts.get(venueName(e)) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([name]) => name)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pl'))
    .map(([name, n]) => `${name} ${n}`)
    .join(' · ');
}

/** A row the paginator places. `build(true)` draws it opening its block (the
 *  block's header, or its top rule) — for a block's first row, and again for
 *  a block continued on a new sheet. */
interface Row {
  build(withHeader: boolean): RowBlock;
  /** Space above the row when it opens its block. */
  gapBefore: number;
}

interface RowBlock extends Block {
  /** Called on the last row of a run — the end of its block, or the last
   *  one before a sheet break — so it can draw the rule that closes it. */
  close?: () => void;
}

/** Place a group's rows across as many sheets as it needs. */
function paginate(
  ctx: Ctx,
  group: ListingGroup,
  caption: string[],
  footer: Footer,
  blocks: Row[][],
  firstGap: number,
): Page[] {
  const pages: Page[] = [];
  let page!: Page;
  let y = 0;
  let placed = 0;

  const open = (cont: boolean) => {
    page = { ops: [], footer };
    pages.push(page);
    const header = listingHeader(ctx, group, caption, cont);
    page.ops.push(() => header.draw(PAD.top));
    y = PAD.top + header.height;
    placed = 0;
  };

  open(false);
  for (const rows of blocks) {
    let prev: RowBlock | null = null;
    rows.forEach((row, i) => {
      const opens = i === 0 || placed === 0;
      let block = row.build(opens);
      let space = opens ? (placed === 0 ? Math.max(firstGap, row.gapBefore) : row.gapBefore) : 0;
      if (placed > 0 && y + space + block.height > LISTING_LIMIT) {
        prev?.close?.();
        open(true);
        block = row.build(true);
        space = Math.max(firstGap, row.gapBefore);
      }
      const at = y + space;
      const b = block;
      page.ops.push(() => b.draw(at));
      y = at + b.height;
      placed++;
      prev = b;
    });
    (prev as RowBlock | null)?.close?.();
  }
  return pages;
}

// ─── Listing: time bands ─────────────────────────────────────────────────────

function bandRows(ctx: Ctx, category: PosterCategory, descLines: number): Row[][] {
  const { t, doc, plan } = ctx;
  const time: Style = { face: 'heavy', size: 32, lh: 0.9, track: -0.035, tnum: true };
  const rail: Style = { face: 'bold', size: 9, lh: 1.55, track: 0.16, upper: true, color: C.a700 };
  const titleS: Style = { face: 'bold', size: 14, lh: 1.15 };
  const venueS: Style = { face: 'bold', size: 9, lh: 1.55, track: 0.16, upper: true };
  const descS: Style = { face: 'regular', size: 10, lh: 1.35 };
  const gridX = LEFT + 104 + 18;
  const colW = (WIDTH - 104 - 18) / 3;
  const textW = colW - 1 - 24;

  // All-day items have no band to sit in; they lead as their own.
  const bands = new Map<string, Event[]>();
  for (const e of category.events) {
    const key = isAllDay(e) ? 'All day' : clock(e.startsAt);
    bands.set(key, [...(bands.get(key) ?? []), e]);
  }

  const rows: Row[] = [];
  for (const [key, unordered] of bands) {
    // Within one time, the picks lead, so the tint reads from the left.
    const events = [...unordered].sort(
      (a, b) => Number(plan.picks.has(b.id)) - Number(plan.picks.has(a.id)),
    );
    const n = events.length;
    for (let i = 0; i < n; i += 3) {
      const chunk = events.slice(i, i + 3);
      let label = count(n, category.noun.one, category.noun.many);
      if (n > 3) {
        const a = i + 1;
        const b = i + chunk.length;
        label += a === b ? ` · ${a}` : ` · ${a}–${b}`;
      } else if (n === 1 && plan.picks.has(chunk[0]!.id)) {
        label += ' — a pick';
      }
      const cells = chunk.map((e) => {
        const pick = plan.picks.has(e.id);
        const free = isFree(e);
        const venue = [venueName(e), free ? FREE_ENTRY : null].filter(Boolean).join(' · ');
        const desc = flat(e.description);
        const descText = desc ? t.clamp(desc, descS, textW, descLines) : '';
        const h = t.height(e.title, titleS, textW) + 4
          + t.height(venue, venueS, textW) + 5
          + (descText ? t.height(descText, descS, textW) : 0);
        return { e, pick, venue, accent: pick || free, descText, h };
      });
      const timeStyle = key === 'All day' ? { ...time, size: 18, upper: true } : time;
      const railH = timeStyle.size * timeStyle.lh + 5 + 9 * 1.55;
      const inner = Math.max(railH, ...cells.map((c) => c.h));
      rows.push({
        gapBefore: 10,
        build: () => {
          let heavy = false;
          return {
            height: 11 + inner + 11 + 2,
            close: () => { heavy = true; },
            draw(y) {
              const top = y + 11;
              t.draw(key, timeStyle, LEFT, top, 104);
              t.draw(label, rail, LEFT, top + timeStyle.size * timeStyle.lh + 5, 104);
              cells.forEach((c, ci) => {
                const cx = gridX + colW * ci;
                if (c.pick) rect(doc, cx, top, colW, inner, C.a100);
                rect(doc, cx, top, 1, inner, C.n300);
                let cy = top;
                cy += t.draw(c.e.title, titleS, cx + 13, cy, textW, { link: c.e.sourceUrl }) + 4;
                cy += t.draw(c.venue, { ...venueS, color: c.accent ? C.a700 : C.n700 }, cx + 13, cy, textW) + 5;
                if (c.descText) t.draw(c.descText, descS, cx + 13, cy, textW);
              });
              const by = top + inner + 11;
              rect(doc, LEFT, by, WIDTH, heavy ? 2 : 1, heavy ? C.divider : C.n300);
            },
          };
        },
      });
    }
  }
  return [rows];
}

function bandCaption(category: PosterCategory, day: string): string[] {
  const timed = category.events.filter((e) => !isAllDay(e))
    .sort((a, b) => minutesIntoDay(a.startsAt, day) - minutesIntoDay(b.startsAt, day));
  const first = timed[0];
  const last = timed[timed.length - 1];
  const span = !first || !last ? 'All day'
    : first === last ? clock(first.startsAt)
      : `${clock(first.startsAt)} → ${clock(last.startsAt)}`;
  return [`${category.events.length} ${category.noun.total}`, span];
}

// ─── Listing: parts of the day ───────────────────────────────────────────────

const PARTS: { part: Exclude<DayPart, 'allday'>; label: string }[] = [
  { part: 'morning', label: 'Morning' },
  { part: 'afternoon', label: 'Afternoon' },
  { part: 'evening', label: 'Evening' },
];

function dayRows(ctx: Ctx, group: ListingGroup, descLines: number): Row[][] {
  const { t, doc, plan } = ctx;
  const primary = group.categories[0]!;
  const events = group.categories.flatMap((c) => c.events);
  const titleS: Style = { face: 'bold', size: 14, lh: 1.15 };
  const venueS: Style = { face: 'bold', size: 9, lh: 1.55, track: 0.16, upper: true };
  const descS: Style = { face: 'regular', size: 10, lh: 1.35 };

  /** The venue line: a merged category names itself, a pick says so. */
  const venueLine = (e: Event) => {
    const cat = plan.categoryOf.get(e.id);
    const foreign = cat && cat !== primary ? cat.label : null;
    const pick = plan.picks.has(e.id);
    const text = [foreign, venueName(e), isFree(e) ? FREE_ENTRY : null, pick ? A_PICK : null]
      .filter(Boolean).join(' · ');
    return { text, accent: !!foreign || pick || isFree(e), pick };
  };

  const out: Row[][] = [];

  // All day: a compact two-column strip of titles and venues.
  const allDay = events.filter(isAllDay).sort((a, b) => a.title.localeCompare(b.title, 'pl'));
  if (allDay.length) {
    const label: Style = { face: 'heavy', size: 15, lh: 1.55, track: 0.06, upper: true };
    const gridX = LEFT + 104 + 18;
    const colW = (WIDTH - 104 - 18 - 18) / 2;
    const rows: Row[] = [];
    for (let i = 0; i < allDay.length; i += 2) {
      const pair = allDay.slice(i, i + 2).map((e) => {
        const v = venueLine(e);
        return { e, v, h: t.height(e.title, titleS, colW) + 4 + t.height(v.text, venueS, colW) };
      });
      const shift = Math.max(0, t.baseline(label) - t.baseline(titleS));
      const inner = Math.max(label.size * label.lh, shift + Math.max(...pair.map((p) => p.h)));
      rows.push({
        gapBefore: 14,
        build: (withHeader) => {
          // Rows sit 18px apart; each keeps 9px under it for the strip's
          // closing padding, so a following row needs only the difference.
          const above = withHeader ? 2 + 9 : 18 - 9 - 1;
          let closing = false;
          return {
            height: above + inner + 9 + 1,
            close: () => { closing = true; },
            draw(y) {
              if (withHeader) rect(doc, LEFT, y, WIDTH, 2, C.text);
              const top = y + above;
              if (withHeader) t.draw('All day', label, LEFT, top, 104);
              pair.forEach((p, pi) => {
                const x = gridX + (colW + 18) * pi;
                if (p.v.pick) rect(doc, x - 4, top + shift - 2, colW + 8, p.h + 4, C.a100);
                const ty = top + shift;
                const th = t.draw(p.e.title, titleS, x, ty, colW, { link: p.e.sourceUrl });
                t.draw(p.v.text, { ...venueS, color: p.v.accent ? C.a700 : C.n700 }, x, ty + th + 4, colW);
              });
              if (closing) rect(doc, LEFT, top + inner + 9, WIDTH, 1, C.n300);
            },
          };
        },
      });
    }
    out.push(rows);
  }

  // Morning, afternoon, evening: a header with the span and the count, then a
  // three-column grid of cells.
  const day = plan.day;
  for (const { part, label } of PARTS) {
    const inPart = events.filter((e) => dayPart(e, day) === part)
      .sort((a, b) => minutesIntoDay(a.startsAt, day) - minutesIntoDay(b.startsAt, day)
        || a.title.localeCompare(b.title, 'pl'));
    if (inPart.length === 0) continue;
    const first = inPart[0]!;
    const last = inPart[inPart.length - 1]!;
    const range = first === last ? clock(first.startsAt) : `${clock(first.startsAt)} → ${clock(last.startsAt)}`;

    const head: Style = { face: 'heavy', size: 24, lh: 1.55, track: -0.02, upper: true };
    const rangeS: Style = { face: 'bold', size: 11, lh: 1.55, track: 0.16, upper: true, color: C.n700 };
    const countS: Style = { face: 'heavy', size: 22, lh: 1.55, color: C.accent };
    const headH = 24 * 1.55 + 4 + 2;
    const timeS: Style = { face: 'heavy', size: 21, lh: 0.9, track: -0.035, tnum: true };
    const colW = WIDTH / 3;
    const textW = colW - 1 - 18;

    const rows: Row[] = [];
    for (let i = 0; i < inPart.length; i += 3) {
      const cells = inPart.slice(i, i + 3).map((e) => {
        const v = venueLine(e);
        const desc = flat(e.description);
        const descText = desc ? t.clamp(desc, descS, textW, descLines) : '';
        const h = 21 * 0.9 + 6 + t.height(e.title, titleS, textW) + 4
          + t.height(v.text, venueS, textW) + 5
          + (descText ? t.height(descText, descS, textW) : 0);
        return { e, v, descText, h };
      });
      const inner = 7 + Math.max(...cells.map((c) => c.h)) + 7;
      rows.push({
        gapBefore: 8,
        build: (withHeader) => {
          let closing = false;
          const hh = withHeader ? headH : 0;
          return {
            height: hh + inner + 1,
            close: () => { closing = true; },
            draw(y) {
              if (withHeader) {
                const lw = t.width(label, head);
                t.draw(label, head, LEFT, y, WIDTH);
                const rTop = t.baseline(head) - t.baseline(rangeS);
                t.draw(range, rangeS, LEFT + lw + 12, y + rTop, WIDTH - lw - 60);
                const cTop = t.baseline(head) - t.baseline(countS);
                t.draw(String(inPart.length), countS, LEFT, y + cTop, WIDTH, { align: 'right' });
                rect(doc, LEFT, y + 24 * 1.55 + 4, WIDTH, 2, C.text);
              }
              const top = y + hh;
              cells.forEach((c, ci) => {
                const cx = LEFT + colW * ci;
                if (c.v.pick) rect(doc, cx, top, colW, inner, C.a100);
                rect(doc, cx, top, 1, inner, C.n300);
                const x = cx + 1 + 9;
                let cy = top + 7;
                t.draw(clock(c.e.startsAt), timeS, x, cy, textW);
                cy += 21 * 0.9 + 6;
                cy += t.draw(c.e.title, titleS, x, cy, textW, { link: c.e.sourceUrl }) + 4;
                cy += t.draw(c.v.text, { ...venueS, color: c.v.accent ? C.a700 : C.n700 }, x, cy, textW) + 5;
                if (c.descText) t.draw(c.descText, descS, x, cy, textW);
              });
              if (closing) rect(doc, LEFT, top + inner, WIDTH, 1, C.n300);
            },
          };
        },
      });
    }
    out.push(rows);
  }
  return out;
}

function dayCaption(group: ListingGroup, day: string): string[] {
  const events = group.categories.flatMap((c) => c.events);
  const timed = events.filter((e) => !isAllDay(e))
    .sort((a, b) => minutesIntoDay(a.startsAt, day) - minutesIntoDay(b.startsAt, day));
  const from = events.some(isAllDay) ? 'All day' : timed[0] ? clock(timed[0].startsAt) : null;
  const lastTimed = timed[timed.length - 1];
  const to = lastTimed ? clock(lastTimed.startsAt) : null;
  const span = from && to && from !== to ? `${from} → ${to}` : from ?? to ?? '';
  const noun = group.categories.length === 1 ? group.categories[0]!.noun.total : 'events';
  return [
    `${events.length} ${noun}`,
    ...(span ? [span] : []),
    places(new Set(events.map((e) => e.venueId)).size),
  ];
}

// ─── Footers ─────────────────────────────────────────────────────────────────

function drawFooter(ctx: Ctx, footer: Footer, sheet: number, of: number): void {
  const { t, doc } = ctx;
  const style: Style = { ...CAPTION, color: C.n700 };
  const top = BOTTOM - CAPTION.size * CAPTION.lh;
  const right = `Sheet ${sheet} of ${of}`;
  const rightW = t.width(right, style) + 4;
  const leftW = WIDTH - rightW - 20;
  t.draw(right, style, LEFT, top, WIDTH, { align: 'right' });

  if (footer.kind === 'front') {
    t.draw('Afisz.ka · afisz.cc', style, LEFT, top, leftW);
  } else if (footer.kind === 'tally') {
    t.draw(t.clamp(footer.text, style, leftW, 1), style, LEFT, top, leftW);
  } else {
    rect(doc, LEFT, top - 12 - 2, WIDTH, 2, C.divider);
    // Real link annotations: a drive-only reader gets no email, so this is
    // the one place their newsletter can offer to change or stop it.
    const settings = `${env.APP_URL}/my?tab=newsletter`;
    const links: [string, string][] = [
      ['Change settings', settings],
      ['Unsubscribe', settings],
      ['Open in Afisz.ka', `${env.APP_URL}/my`],
    ];
    let x = LEFT;
    links.forEach(([label, href], i) => {
      t.draw(label, style, x, top, leftW, { link: href });
      x += t.width(label, style);
      if (i < links.length - 1) {
        t.draw(' · ', style, x, top, 40);
        x += t.width(' · ', style);
      }
    });
  }
}

// ─── Entry points ────────────────────────────────────────────────────────────

/** A daily issue: every section covers a single day. */
export function isDailyIssue(sections: BriefSection[]): boolean {
  return sections.length > 0 && sections.every((s) => s.windowDays <= 1);
}

/** Draw the daily poster and resolve with the PDF bytes. */
export function renderDailyPosterPdf(content: BriefPdfContent): Promise<Buffer> {
  const now = content.now ?? new Date();
  const plan = planPoster({
    sections: content.sections,
    savedEventIds: content.savedEventIds,
    now,
  });

  const doc: Doc = new PDFDocument({
    size: [PAGE_PT.width, PAGE_PT.height],
    margin: 0,
    autoFirstPage: false,
    info: {
      Title: `${PL.wordmark} Daily — ${plan.day}`,
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

  const ctx: Ctx = { doc, t: new Typesetter(doc), plan };

  // Lay every sheet out first: "Sheet X of N" needs N before anything is drawn.
  const front = frontBlocks(ctx, content, now);
  const pages: Page[] = [{
    footer: { kind: 'front' },
    ops: (() => {
      const ops: (() => void)[] = [];
      let y = PAD.top;
      for (const b of front) {
        const at = y;
        ops.push(() => b.draw(at));
        y += b.height;
      }
      return ops;
    })(),
  }];

  for (const group of plan.groups) {
    const events = group.categories.flatMap((c) => c.events);
    const footer: Footer = { kind: 'tally', text: tally(events) };
    const layout = (descLines: number) => group.layout === 'bands'
      ? paginate(ctx, group, bandCaption(group.categories[0]!, plan.day), footer,
        bandRows(ctx, group.categories[0]!, descLines), 10)
      : paginate(ctx, group, dayCaption(group, plan.day), footer,
        dayRows(ctx, group, descLines), 14);
    // The design's clamp first (3 lines in a band, 2 in a part of the day);
    // one line shorter only when that saves a whole sheet — a sheet carrying
    // one stray row is worse than blurbs a line shorter.
    const full = layout(group.layout === 'bands' ? 3 : 2);
    const tight = full.length > 1 ? layout(1) : full;
    pages.push(...(tight.length < full.length ? tight : full));
  }
  // The last sheet carries the reader's way out instead of a venue tally.
  pages[pages.length - 1]!.footer = { kind: 'links' };

  pages.forEach((page, i) => {
    doc.addPage({ size: [PAGE_PT.width, PAGE_PT.height], margin: 0 });
    rect(doc, 0, 0, PAGE.width, PAGE.height, C.bg);
    for (const op of page.ops) op();
    drawFooter(ctx, page.footer, i + 1, pages.length);
  });

  doc.end();
  return done;
}
