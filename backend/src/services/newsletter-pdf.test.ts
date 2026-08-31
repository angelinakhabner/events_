import { describe, it, expect } from 'vitest';
import type { Event, Festival } from '@afisz/shared';
import { renderBriefPdf, briefPdfFilename, resolveFontDir } from './newsletter-pdf.js';
import type { BriefSection } from './newsletter-render.js';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The PDF is checked by reading it back rather than by byte-comparing a
 * fixture: pdfkit stamps a creation date and object ids, so a golden file
 * would fail on every run for reasons that have nothing to do with the brief.
 * Reading the text out also happens to prove the thing most likely to break —
 * that Polish survives the font embedding.
 */
async function textOf(
  pdf: Buffer,
): Promise<{ pages: number; text: string; flat: string; links: string[] }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: false }).promise;
  let text = '';
  const links: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    text += content.items.map((i) => ('str' in i ? i.str : '')).join(' ') + '\n';
    for (const a of await page.getAnnotations()) {
      if (typeof (a as { url?: unknown }).url === 'string') links.push((a as { url: string }).url);
    }
  }
  // The brief's labels are letterspaced, and tracking that wide makes pdf.js
  // emit one text item per glyph — `CHCĘ IŚĆ` reads back as `C H C Ę   I Ś Ć`.
  // `flat` drops whitespace so an assertion can ask about the letters, which is
  // what it means; order is preserved, so `indexOf` still compares positions.
  return { pages: doc.numPages, text, flat: text.replace(/\s+/g, ''), links };
}

/** Assert against `flat` without writing the expectation letter by letter. */
const squash = (s: string) => s.replace(/\s+/g, '');

const event = (over: Partial<Event> = {}): Event =>
  ({
    id: Math.random().toString(36).slice(2),
    venueId: 'v1',
    title: 'Zimna wojna',
    description: null,
    startsAt: '2026-09-10T16:00:00.000Z',
    endsAt: null,
    kind: 'timed',
    category: 'cinema',
    language: 'pl',
    sourceUrl: 'https://kinomuranow.pl/film/zimna-wojna',
    venue: { id: 'v1', name: 'Kino Muranów', city: 'Warsaw' },
    ...over,
  }) as Event;

const section = (over: Partial<BriefSection> = {}): BriefSection =>
  ({ category: 'Kino', windowDays: 7, detail: 'full', events: [event()], ...over }) as BriefSection;

describe('renderBriefPdf', () => {
  it('produces a readable PDF carrying the brief', async () => {
    const pdf = await renderBriefPdf({
      sections: [section()],
      recipientName: 'Angelina',
      now: new Date('2026-09-09T08:00:00.000Z'),
    });

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const { pages, text } = await textOf(pdf);
    expect(pages).toBe(1);
    expect(text).toContain('AFISZ.KA');
    expect(text).toContain('WARSZAWA');
    expect(text).toContain('Zimna wojna');
    // Named, not greeted — Polish would need the vocative, which cannot be
    // derived from an arbitrary name.
    expect(text).toContain('Angelina — 1 wydarzenie');
  });

  /** Polish counts in three forms, and copy that gets it wrong reads as
   *  generated. 1 / 2-4 / the rest, with the teens taking the third. */
  it('counts in Polish', async () => {
    const counted = async (n: number) => {
      const pdf = await renderBriefPdf({
        sections: [
          section({
            events: Array.from({ length: n }, (_, i) => event({ title: `Film ${i}` })),
          }),
        ],
        now: new Date('2026-09-09T08:00:00.000Z'),
      });
      return (await textOf(pdf)).text;
    };

    expect(await counted(1)).toContain('1 wydarzenie');
    expect(await counted(3)).toContain('3 wydarzenia');
    expect(await counted(5)).toContain('5 wydarzeń');
    expect(await counted(12)).toContain('12 wydarzeń');
  });

  /**
   * The reason the fonts are embedded at all. PDF's built-in Helvetica is
   * WinAnsi-encoded and has none of these letters, so a regression here shows
   * up as Polish titles quietly losing characters rather than as an error.
   */
  it('keeps Polish diacritics intact', async () => {
    const pdf = await renderBriefPdf({
      sections: [
        section({
          events: [
            event({
              title: 'Zdzisław Beksiński — źródła',
              description: 'Opowieść o miłości niemożliwej: zdjęcia Łukasza Żala, reżyseria Paweł Pawlikowski.',
              venue: { id: 'v1', name: 'Kino Muranów', city: 'Warsaw' } as Event['venue'],
            }),
          ],
        }),
      ],
      now: new Date('2026-09-09T08:00:00.000Z'),
    });

    const { text, flat } = await textOf(pdf);
    expect(text).toContain('Zdzisław Beksiński');
    expect(text).toContain('źródła');
    // The venue line is set in caps, so the diacritics have to survive the
    // uppercasing too — `ó` and `Ó` are separate glyphs in the subset.
    expect(flat).toContain(squash('KINO MURANÓW'));
    expect(text).toContain('Opowieść o miłości niemożliwej');
    expect(text).toContain('Łukasza Żala');
    expect(text).toContain('reżyseria');
  });

  it('collapses one title showing at several venues into a single pick', async () => {
    const pdf = await renderBriefPdf({
      sections: [
        section({
          events: [
            event({ startsAt: '2026-09-10T16:00:00.000Z' }),
            event({
              startsAt: '2026-09-10T18:30:00.000Z',
              venue: { id: 'v2', name: 'Kinoteka', city: 'Warsaw' } as Event['venue'],
            }),
          ],
        }),
      ],
      now: new Date('2026-09-09T08:00:00.000Z'),
    });

    const { text, flat } = await textOf(pdf);
    // One title, both venues, both times — each venue on its own line, so two
    // cinemas showing the same film read as two places rather than one string.
    expect(text.match(/Zimna wojna/g)).toHaveLength(1);
    expect(flat).toContain(squash('KINO MURANÓW · 18:00'));
    expect(flat).toContain(squash('KINOTEKA · 20:30'));
  });

  it('says so plainly when there is nothing on', async () => {
    const pdf = await renderBriefPdf({
      sections: [],
      fallbackFrequency: 'weekly',
      now: new Date('2026-09-09T08:00:00.000Z'),
    });
    const { text } = await textOf(pdf);
    expect(text).toContain('nic nie znaleźliśmy');
    expect(text).toContain('0 wydarzeń');
  });

  /**
   * GOI-67: an exhibition runs for months, so a start time in the gutter says
   * nothing a reader can act on. What they need is the date it comes down.
   */
  it('dates an exhibition by its closing rather than by a showtime', async () => {
    const pdf = await renderBriefPdf({
      sections: [
        section({
          category: 'Wystawy',
          events: [
            event({
              title: 'Nowa rzeźba polska',
              kind: 'exhibition',
              startsAt: '2026-06-01T08:00:00.000Z',
              endsAt: '2026-09-14T16:00:00.000Z',
              venue: { id: 'v9', name: 'Zachęta', city: 'Warsaw' } as Event['venue'],
            }),
          ],
        }),
      ],
      now: new Date('2026-09-09T08:00:00.000Z'),
    });

    const { text, flat } = await textOf(pdf);
    expect(flat).toContain(squash('DO 14 WRZEŚNIA'));
    expect(flat).toContain(squash('ZACHĘTA'));
    expect(text).toContain('Nowa rzeźba polska');
    // No 10:00 gutter beside it, which is what the timed layout would have put
    // there for an 08:00Z start.
    expect(flat).not.toContain('10:00');
  });

  it('names an ongoing festival', async () => {
    const festival = {
      id: 'wff', name: 'Warszawski Festiwal Filmowy', url: 'https://wff.pl',
      cinemas: ['Kinoteka'], city: 'Warsaw',
      startDate: '2026-09-08', endDate: '2026-09-18', description: 'x',
    } as unknown as Festival;

    const pdf = await renderBriefPdf({
      sections: [section()],
      festival,
      now: new Date('2026-09-09T08:00:00.000Z'),
    });
    const { text } = await textOf(pdf);
    expect(text).toContain('Warszawski Festiwal Filmowy');
  });

  it('paginates a long brief instead of overflowing one page', async () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      event({
        title: `Film numer ${i}`,
        startsAt: `2026-09-${String(10 + (i % 15)).padStart(2, '0')}T16:00:00.000Z`,
        description: 'Opis filmu, dostatecznie długi, by zajął miejsce na stronie i wymusił łamanie.',
      }),
    );
    const pdf = await renderBriefPdf({
      sections: [section({ events: many })],
      now: new Date('2026-09-09T08:00:00.000Z'),
    });

    const { pages, text } = await textOf(pdf);
    expect(pages).toBeGreaterThan(1);
    expect(text).toContain('Film numer 0');
    expect(text).toContain('Film numer 39');
  });
});

/**
 * The saved-events queue in the PDF (GOI-101).
 *
 * It was absent from the PDF for as long as the PDF was a filed copy of an
 * email that carried it. Once a reader can choose the drive *instead* of the
 * email, that omission means the one part of the brief that asks them to do
 * something never reaches them at all — so these are regression tests for a
 * gap the delivery choice opened, not for new formatting.
 */
describe('the saved-events queue', () => {
  const queued = (over: Partial<Event> = {}) => event({ title: 'Hamlet', ...over });

  it('carries reminders and changes, above the category sections', async () => {
    const pdf = await renderBriefPdf({
      sections: [section()],
      wantToGo: {
        changes: [
          {
            event: queued({ title: 'Kordian', startsAt: '2026-09-10T17:00:00.000Z' }),
            type: 'cancelled', oldValue: null, newValue: null,
          },
        ],
        reminders: [
          { event: queued({ startsAt: '2026-09-10T17:00:00.000Z' }), state: 'tomorrow' },
        ],
      },
      now: new Date('2026-09-09T08:00:00.000Z'),
    });

    const { text, flat } = await textOf(pdf);
    expect(flat).toContain(squash('CHCĘ IŚĆ'));
    expect(text).toContain('Kordian');
    expect(flat).toContain(squash('ODWOŁANE'));
    expect(text).toContain('Hamlet');
    // Above the category section it shares the page with.
    expect(flat.indexOf(squash('CHCĘ IŚĆ'))).toBeLessThan(flat.indexOf('KINO'));
  });

  /** The states are three different requests, not degrees of one, so each gets
   *  its own subheading rather than being listed flat. */
  it('groups reminders by state, urgent first', async () => {
    const pdf = await renderBriefPdf({
      sections: [],
      fallbackFrequency: 'weekly',
      wantToGo: {
        changes: [],
        reminders: [
          { event: queued({ title: 'Amator', startsAt: '2026-09-14T17:00:00.000Z' }), state: 'this_week' },
          { event: queued({ title: 'Persona', startsAt: '2026-09-10T17:00:00.000Z' }), state: 'tomorrow' },
          { event: queued({ title: 'Wesele', startsAt: '2026-09-11T17:00:00.000Z' }), state: 'last_chance' },
        ],
      },
      now: new Date('2026-09-09T08:00:00.000Z'),
    });

    const { flat } = await textOf(pdf);
    const at = (s: string) => flat.indexOf(squash(s));
    expect(at('OSTATNIA SZANSA')).toBeGreaterThan(-1);
    expect(at('OSTATNIA SZANSA')).toBeLessThan(at('JUTRO'));
    expect(at('JUTRO')).toBeLessThan(at('W TYM TYGODNIU'));
    // Each title sits under its own state, not in the order it was passed in.
    expect(at('Wesele')).toBeLessThan(at('Persona'));
    expect(at('Persona')).toBeLessThan(at('Amator'));
  });

  /** A brief with an empty queue and no events says nothing is on; a brief
   *  with only a queue is not empty, and must not say so. */
  it('is enough on its own to make a brief non-empty', async () => {
    const pdf = await renderBriefPdf({
      sections: [],
      fallbackFrequency: 'weekly',
      wantToGo: {
        changes: [],
        reminders: [{ event: queued(), state: 'tomorrow' }],
      },
      now: new Date('2026-09-09T08:00:00.000Z'),
    });

    const { text } = await textOf(pdf);
    expect(text).toContain('Hamlet');
    expect(text).not.toContain('nic nie znaleźliśmy');
  });
});

/**
 * A reader who chose `drive` gets no email, so this page is the only place
 * their newsletter can offer them a way to change it or stop it. Styled text
 * that says "Wypisz się" is not that; a link annotation is.
 */
describe('the footer', () => {
  it('carries real links to settings and unsubscribe', async () => {
    const pdf = await renderBriefPdf({
      sections: [section()],
      now: new Date('2026-09-09T08:00:00.000Z'),
    });

    const { text, links } = await textOf(pdf);
    expect(text).toContain('Wypisz się');
    expect(links).toHaveLength(3);
    expect(links.filter((l) => l.includes('tab=newsletter'))).toHaveLength(2);
    expect(links.every((l) => l.startsWith('http'))).toBe(true);
  });
});

describe('briefPdfFilename', () => {
  it('leads with an ISO date so a drive folder sorts chronologically by name', () => {
    expect(briefPdfFilename(new Date('2026-09-09T08:00:00.000Z'), 'weekly'))
      .toBe('afisz-2026-09-09-weekly.pdf');
  });

  it('dates the file by the Warsaw day, not the UTC one', () => {
    // 23:30Z on the 9th is already 01:30 on the 10th in Warsaw.
    expect(briefPdfFilename(new Date('2026-09-09T23:30:00.000Z'), 'daily'))
      .toBe('afisz-2026-09-10-daily.pdf');
  });
});

/**
 * GOI-96: the fonts were addressed as a fixed `../../assets/fonts` from this
 * module, which only ever pointed at the right place when the brief ran as
 * TypeScript. Built, the same path resolved inside `dist`, where the fonts
 * are not, and generating a brief failed with a bare ENOENT.
 */
describe('resolveFontDir', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const backend = path.resolve(here, '../..');

  it('finds the one copy of the fonts from the source layout', () => {
    expect(resolveFontDir(here)).toBe(path.join(backend, 'assets', 'fonts'));
    expect(existsSync(path.join(resolveFontDir(here), 'DejaVuSans.subset.ttf'))).toBe(true);
  });

  // The path `tsc -p tsconfig.build.json` actually emits to. Nothing copies
  // `assets/` into `dist`, so the fonts have to be found above it.
  it('finds them from the compiled dist layout too', () => {
    const fromDist = path.join(backend, 'dist', 'backend', 'src', 'services');
    expect(resolveFontDir(fromDist)).toBe(path.join(backend, 'assets', 'fonts'));
  });

  it('says what is missing rather than throwing a bare ENOENT', () => {
    expect(() => resolveFontDir(path.parse(here).root)).toThrow(/DejaVuSans\.subset\.ttf/);
  });
});
