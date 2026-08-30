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
async function textOf(pdf: Buffer): Promise<{ pages: number; text: string }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: false }).promise;
  let text = '';
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    text += content.items.map((i) => ('str' in i ? i.str : '')).join(' ') + '\n';
  }
  return { pages: doc.numPages, text };
}

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
  ({ category: 'cinema', frequency: 'weekly', detail: 'full', events: [event()], ...over }) as BriefSection;

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
    expect(text).toContain('AFISZ');
    expect(text).toContain('Zimna wojna');
    expect(text).toContain('Angelina');
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

    const { text } = await textOf(pdf);
    expect(text).toContain('Zdzisław Beksiński');
    expect(text).toContain('źródła');
    expect(text).toContain('Kino Muranów');
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

    const { text } = await textOf(pdf);
    // One title, both venues, both times.
    expect(text.match(/Zimna wojna/g)).toHaveLength(1);
    expect(text).toContain('Kino Muranów');
    expect(text).toContain('Kinoteka');
    expect(text).toContain('18:00');
    expect(text).toContain('20:30');
  });

  it('says so plainly when there is nothing on', async () => {
    const pdf = await renderBriefPdf({
      sections: [],
      fallbackFrequency: 'weekly',
      now: new Date('2026-09-09T08:00:00.000Z'),
    });
    const { text } = await textOf(pdf);
    expect(text).toContain('Nothing on at your venues');
    expect(text).toContain('0 picks');
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
