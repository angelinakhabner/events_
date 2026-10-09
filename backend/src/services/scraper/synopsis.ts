import * as cheerio from 'cheerio';

/**
 * A venue's own synopsis of a show, read from the show's page by a rule
 * written for that venue's site.
 *
 * The writer was being handed the whole page and left to find the synopsis in
 * it — and at the museums and theatres the page is mostly opening hours,
 * ticket boxes, the address and the rest of the programme, so what it found
 * was as often the logistics as the work. Every one of these sites puts the
 * text about the work in the same place on every show page, so a rule per
 * site reads it exactly, for free, in the venue's own words.
 *
 * Rules are keyed by hostname (no `www.`), not by venue: the show pages a
 * listing links to are what is read, and the same rule then serves a
 * user-added venue on that host too.
 */
type Rule = (html: string) => string | null;

const RULES: Record<string, Rule> = {
  // Next.js, rendered in the browser: the server's HTML says "Wczytywanie…"
  // and its meta description is the theatre's slogan. The synopsis is in the
  // page's flight data, as the first `content max-w-3xl` block; the second is
  // the accessibility note.
  'powszechny.com': (html) => {
    const block = flightHtml(html, '"className":"content max-w-3xl"');
    return block ? paragraphs(block, ['body']) : null;
  },
  // "O spektaklu". The page's lead line, dates, ticket prices and cast all sit
  // outside this block.
  'trwarszawa.pl': (html) => paragraphs(html, ['.trw-template-body']),
  // The article column holds the synopsis; credits and the stage box sit
  // beside it.
  'teatrstudio.pl': (html) => paragraphs(html, ['article.o-article']),
  // Two `.text` columns; the first is an empty spacer.
  'nowyteatr.org': (html) => paragraphs(html, ['.offset-right-1.text']),
  // `.module-text` is every text box on the page: the event's header (title,
  // room, "wstęp wolny"), the text, the registration notice. An exhibition's
  // opens with the gallery and curators and its lead is an <h3>; after the
  // text come photo credits, visitor notices and the partners.
  'zacheta.art.pl': (html) => {
    const stopAt = /^(zdjęcie|fot\.|partner|patron)/i;
    return (
      // From the exhibition's lead on, past the gallery and artist list.
      paragraphs(html, ['.section-exhibition .module-text'], { para: 'h3, h3 ~ p', stopAt }) ??
      paragraphs(html, ['.module-text:not(:has(.event-title))'], { stopAt })
    );
  },
  // The text is split over two `.description` blocks, a paragraph per <div>.
  'artmuseum.pl': (html) =>
    paragraphs(html, ['section.text .description'], { para: ':scope > div', all: true }),
  'u-jazdowski.pl': (html) => paragraphs(html, ['.event-tab-content .body'], { para: 'p, li' }),
  // The edito museums (MNW and its branches): the event's own text is the
  // run of paragraphs at the top of `.events-details`, up to the "Termin:"
  // block of practicalities. Below that come accessibility notes and the
  // season's blurb, then the rest of the month's calendar.
  'mnw.art.pl': edito,
  'krolikarnia.mnw.art.pl': edito,
  'postermuseum.pl': edito,
};

function edito(html: string): string | null {
  return paragraphs(html, ['.events-details'], {
    para: ':scope > p, :scope > div:not([class])',
    // Sometimes a paragraph of its own, sometimes run on after the text.
    stopAt: /\btermin\s*:/i,
  });
}

/** Longest synopsis passed on. A show page's text about the work fits; the
 *  cap only stops a rule that matched too much from sending a whole page. */
export const MAX_SYNOPSIS_CHARS = 3_000;

/** A synopsis shorter than this is a caption or a label, not a synopsis. */
const MIN_SYNOPSIS_CHARS = 60;

/** The synopsis on a show page, or null when its site has no rule or the
 *  rule found nothing worth the name. */
export function venueSynopsis(html: string, url: string): string | null {
  const rule = ruleFor(url);
  if (!rule) return null;
  const text = rule(html);
  if (!text || text.length < MIN_SYNOPSIS_CHARS) return null;
  return text.length <= MAX_SYNOPSIS_CHARS ? text : cut(text, MAX_SYNOPSIS_CHARS);
}

/** Whether pages on this URL's site have a synopsis rule. */
export function hasSynopsisRule(url: string): boolean {
  return ruleFor(url) !== null;
}

function ruleFor(url: string): Rule | null {
  try {
    return RULES[new URL(url).hostname.replace(/^www\./, '')] ?? null;
  } catch {
    return null;
  }
}

/**
 * Lines of logistics a synopsis block often carries alongside the text about
 * the work: hours, dates, prices, booking, the room, who it is for. Dropped
 * paragraph by paragraph, so a synopsis that merely mentions a ticket keeps it.
 */
const LOGISTICS = [
  /^(godz\.?|godzina|w godz)\s*\d/i,
  /^\d{1,2}[.:]\d{2}(\s*[-–]\s*\d{1,2}[.:]\d{2})?\b/,
  /^(bilety?|wstęp|cena|ceny|tickets?|admission|rezerwacj|zapisy|zapisz|kup bilet|buy ticket)/i,
  /^(miejsce|scena|sala|place|venue|lokalizacja)\s*:/i,
  /^(czas trwania|duration|premiera|premiere)\s*:/i,
  /\b(\d+\s*(zł|pln)|bezpłatn|free admission)\b/i,
];

interface ParagraphOptions {
  /** What a paragraph is, inside the matched block. Default `p`. */
  para?: string;
  /** Ends the text where it matches — at a paragraph's start, or partway
   *  through one that runs on into the practicalities. */
  stopAt?: RegExp;
  /** Join every block the selector matches, for a text split across several
   *  rather than one of several candidates. */
  all?: boolean;
}

/**
 * The text of the paragraphs in the first block a selector matches that has
 * a synopsis' worth, with logistics paragraphs dropped. Paragraph-wise rather
 * than the block's whole text so a heading, a credits table or a button row
 * inside it does not run into the synopsis.
 */
export function paragraphs(html: string, selectors: string[], opts: ParagraphOptions = {}): string | null {
  const { para = 'p', stopAt, all = false } = opts;
  const $ = cheerio.load(html);
  const read = ($roots: ReturnType<typeof $>): string => {
    const blocks: string[] = [];
    for (const root of $roots.toArray()) {
      const $root = $(root);
      $root.find('script, style, noscript, form, button').remove();
      const $paras = $root.find(para);
      for (const el of ($paras.length > 0 ? $paras : $root).toArray()) {
        let t = squash($(el).text());
        const stop = stopAt ? t.search(stopAt) : -1;
        if (stop >= 0) t = t.slice(0, stop).trim();
        if (t.length > 0 && !LOGISTICS.some((re) => re.test(t))) blocks.push(t);
        if (stop >= 0) return dedupe(blocks).join('\n\n');
      }
    }
    return dedupe(blocks).join('\n\n');
  };
  for (const sel of selectors) {
    const $roots = $(sel);
    const candidates = all ? [read($roots)] : $roots.toArray().map((r) => read($(r)));
    for (const text of candidates) {
      if (text.length >= MIN_SYNOPSIS_CHARS) return text;
    }
  }
  return null;
}

/**
 * An HTML block from a Next.js page's flight data (the
 * `self.__next_f.push([1, "…"])` scripts): the `__html` of the first
 * `dangerouslySetInnerHTML` after `marker`. Long blocks are not inline but a
 * `"$25"` reference to a text row — `25:T<hex byte length>,<html>` — which is
 * resolved here.
 */
export function flightHtml(html: string, marker: string): string | null {
  let flight = '';
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try {
      flight += JSON.parse(m[1]!) as string;
    } catch {
      // One undecodable chunk loses at most the block inside it.
    }
  }
  const at = flight.indexOf(marker);
  if (at < 0) return null;
  const m = flight.slice(at).match(/^[^}]*?"dangerouslySetInnerHTML":\{"__html":("(?:[^"\\]|\\.)*")\}/);
  if (!m) return null;
  const value = JSON.parse(m[1]!) as string;
  const ref = value.match(/^\$([0-9a-f]+)$/)?.[1];
  if (!ref) return value;
  const row = flight.match(new RegExp(`(?:^|\\n)${ref}:T([0-9a-f]+),`));
  if (!row || row.index === undefined) return null;
  // The length is in UTF-8 bytes, not UTF-16 code units.
  const start = row.index + row[0].length;
  const bytes = Buffer.from(flight.slice(start), 'utf8');
  return bytes.subarray(0, parseInt(row[1]!, 16)).toString('utf8');
}

function squash(s: string): string {
  // Soft hyphens: Powszechny hyphenates its quotations by hand.
  return s.replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim();
}

/** A nested `<p>` inside a `<div>` matched by `para` would otherwise be read
 *  twice. */
function dedupe(blocks: string[]): string[] {
  return blocks.filter((b, i) => !blocks.some((o, j) => j !== i && o.length > b.length && o.includes(b)));
}

function cut(text: string, max: number): string {
  const head = text.slice(0, max);
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('\n'));
  return end > max / 2 ? head.slice(0, end + 1).trim() : `${head.slice(0, head.lastIndexOf(' '))}…`;
}

