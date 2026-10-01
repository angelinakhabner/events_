import { describe, it, expect } from 'vitest';
import type { Event } from '@afisz/shared';
import { renderBriefPdf } from './newsletter-pdf.js';
import { isDailyIssue } from './newsletter-poster-pdf.js';
import type { BriefSection } from './newsletter-render.js';
import { env } from '../config.js';
import { pdfText, squash } from '../__tests__/pdf-text.js';
import {
  CINEMA, SAMPLE_NOW, SAMPLE_SAVED, SAMPLE_SECTIONS,
} from '../__tests__/fixtures/daily-poster-day.js';

/**
 * The daily poster, read back out of the PDF. Byte-comparing is useless
 * (pdfkit stamps dates and object ids), and reading the text also proves the
 * Archivo subset carries Polish.
 */

const sample = () => renderBriefPdf({
  sections: SAMPLE_SECTIONS,
  savedEventIds: SAMPLE_SAVED,
  recipientName: 'Angelina',
  issueNo: 3,
  now: SAMPLE_NOW,
});

const films = (n: number, hhmm: string): Event[] =>
  Array.from({ length: n }, (_, i) => ({
    ...CINEMA[0]!,
    id: `f${hhmm}-${i}`,
    title: `Film ${hhmm} ${i + 1}`,
    startsAt: new Date(`2026-09-04T${hhmm}:00+02:00`).toISOString(),
  }));

const cinema = (events: Event[]): BriefSection[] =>
  [{ category: 'cinema', windowDays: 1, detail: 'full', events }];

describe('isDailyIssue', () => {
  it('is a daily issue only when every section covers one day', () => {
    expect(isDailyIssue(SAMPLE_SECTIONS)).toBe(true);
    expect(isDailyIssue([...SAMPLE_SECTIONS, { ...SAMPLE_SECTIONS[0]!, windowDays: 7 }])).toBe(false);
    expect(isDailyIssue([])).toBe(false);
  });
});

describe('the daily poster', () => {
  it('draws the sample day on three sheets, as the design does', async () => {
    const { pages, flat, flatPages } = await pdfText(await sample());
    expect(pages).toHaveLength(3);
    expect(flatPages[0]).toContain(squash('ARKUSZ 1 Z 3'));
    expect(flatPages[2]).toContain(squash('ARKUSZ 3 Z 3'));

    // The front: masthead, fact band, dedication, hero, the two lists.
    expect(flatPages[0]).toContain(squash('AFISZ.KA'));
    expect(flatPages[0]).toContain(squash('DZIENNIK NR 3 AFISZ.CC'));
    expect(flatPages[0]).toContain(squash('PIĄTEK'));
    expect(flatPages[0]).toContain(squash('31 WYDARZEŃ'));
    expect(flatPages[0]).toContain(squash('8 MIEJSC'));
    expect(flatPages[0]).toContain(squash('ANGELINA — WYBRANE Z MIEJSC, KTÓRE OBSERWUJESZ'));
    expect(flatPages[0]).toContain(squash('DZIŚ WIECZOREM — NUMER JEDEN'));
    expect(flatPages[0]).toContain(squash('22:35 SIRÂT'));
    expect(flatPages[0]).toContain(squash('JESZCZE TRZY NA DZIŚ'));
    expect(flatPages[0]).toContain(squash('CHCĘ IŚĆ'));
    expect(flatPages[0]).toContain(squash('Guided tour of Zofia and Oskar Hansen’s home'));
    expect(flatPages[0]!.indexOf(squash('JESZCZE TRZY'))).toBeLessThan(flatPages[0]!.indexOf(squash('CHCĘ IŚĆ')));

    // The listing: cinema in time bands, then exhibitions with music merged in.
    expect(flatPages[1]).toContain(squash('KINO'));
    expect(flatPages[1]).toContain(squash('15 SEANSÓW'));
    expect(flatPages[1]).toContain(squash('5 FILMÓW · 1–3'));
    expect(flatPages[1]).toContain(squash('5 FILMÓW · 4–5'));
    expect(flatPages[1]).toContain(squash('KINO MURANÓW 7 · KINOTEKA 7 · KINO ILUZJON 1'));
    expect(flatPages[2]).toContain(squash('WYSTAWY & MUZYKA'));
    expect(flatPages[2]).toContain(squash('PIĘĆ MIEJSC'));
    expect(flatPages[2]).toContain(squash('RANO'));
    expect(flatPages[2]).toContain(squash('PO POŁUDNIU'));
    expect(flatPages[2]).toContain(squash('WIECZOREM'));
    expect(flatPages[2]).toContain(squash('MUZYKA · FILHARMONIA NARODOWA'));
    // Polish survives the subset.
    expect(flat).toContain(squash('Działania performatywne / Rzeźba nas obchodzi'));
  });

  it('closes on real links to change or stop it', async () => {
    const { flatPages, links } = await pdfText(await sample());
    expect(flatPages[2]).toContain(squash('ZMIEŃ USTAWIENIA · WYPISZ SIĘ · OTWÓRZ W AFISZ.KA'));
    expect(links).toContain(`${env.APP_URL}/my?tab=newsletter`);
    expect(links).toContain(`${env.APP_URL}/my`);
  });

  it('leaves out what it does not know, rather than guessing', async () => {
    const pdf = await renderBriefPdf({ sections: SAMPLE_SECTIONS, now: SAMPLE_NOW });
    const { flatPages } = await pdfText(pdf);
    expect(flatPages[0]).not.toContain(squash('NR '));
    expect(flatPages[0]).not.toContain(squash('CHCĘ IŚĆ'));
    expect(flatPages[0]).toContain(squash('WYBRANE Z MIEJSC, KTÓRE OBSERWUJESZ'));
    // Straight from the fact band into the line, with no name before it.
    expect(flatPages[0]).toContain(squash('8 MIEJSC WYBRANE Z'));
  });

  it('never squeezes a fourth film into a band', async () => {
    const { flat } = await pdfText(await renderBriefPdf({ sections: cinema(films(7, '20:30')), now: SAMPLE_NOW }));
    expect(flat).toContain(squash('7 FILMÓW · 1–3'));
    expect(flat).toContain(squash('7 FILMÓW · 4–6'));
    expect(flat).toContain(squash('7 FILMÓW · 7'));
  });

  it('continues a long category on another sheet, and numbers every sheet', async () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      `${String(18 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`)
      .flatMap((t) => films(3, t));
    const { pages, flatPages } = await pdfText(await renderBriefPdf({ sections: cinema(events), now: SAMPLE_NOW }));
    expect(pages.length).toBeGreaterThan(2);
    expect(flatPages[2]).toContain(squash('KINO (CD.)'));
    pages.forEach((_, i) => {
      expect(flatPages[i]).toContain(squash(`ARKUSZ ${i + 1} Z ${pages.length}`));
    });
    // Each film is listed once in the listing.
    const listing = flatPages.slice(1).join('');
    for (const e of events) {
      expect(listing.split(squash(e.title)).length - 1).toBe(1);
    }
  });

  it('hides "Jeszcze trzy" when there is nothing left after the hero', async () => {
    const { flatPages } = await pdfText(await renderBriefPdf({ sections: cinema(films(1, '20:00')), now: SAMPLE_NOW }));
    expect(flatPages[0]).toContain(squash('DZIŚ WIECZOREM — NUMER JEDEN'));
    expect(flatPages[0]).not.toContain(squash('JESZCZE TRZY'));
    expect(flatPages[1]).toContain(squash('1 FILM — POLECAMY'));
  });

  it('keeps the list layout for anything wider than a day', async () => {
    const { flat } = await pdfText(await renderBriefPdf({
      sections: [{ ...SAMPLE_SECTIONS[0]!, windowDays: 7 }],
      now: SAMPLE_NOW,
    }));
    expect(flat).not.toContain(squash('DZIŚ WIECZOREM — NUMER JEDEN'));
    expect(flat).toContain(squash('WARSZAWA'));
  });
});
