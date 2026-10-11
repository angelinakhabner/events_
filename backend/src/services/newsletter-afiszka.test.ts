import { describe, it, expect } from 'vitest';
import type { Event } from '@afisz/shared';
import type { BriefSection } from './newsletter-render.js';
import {
  buildEntries, buildAfiszkaIssue, dateRun, describe as describeText, isReferenced, isTimeBanded,
  scorePick, type AfiszkaEntry,
} from './newsletter-afiszka.js';
import { renderAfiszkaHtml } from './newsletter-afiszka-html.js';
import { renderAfiszkaPdf } from './newsletter-afiszka-pdf.js';
import { renderNewsletterHtml } from './newsletter-design.js';
import { newsletterSaveInput } from './newsletter-input.js';
import { InMemoryNewsletterStore } from './newsletter-store.js';

/** A Friday morning in Warsaw (CEST = UTC+2). */
const NOW = new Date('2026-09-04T06:00:00Z');

let seq = 0;
function ev(over: Partial<Event> & { title: string; startsAt: string }): Event {
  const venueId = over.venueId ?? 'muranow';
  return {
    id: `e${seq++}`,
    venueId,
    venue: { id: venueId, name: venueId === 'muranow' ? 'Kino Muranów' : venueId, category: 'cinema', city: 'Warsaw', country: 'PL' } as Event['venue'],
    description: null,
    endsAt: null,
    category: 'cinema',
    language: null,
    director: null,
    cast: [],
    durationMinutes: null,
    priceMin: null,
    priceMax: null,
    sourceUrl: 'https://example.com/e',
    sourceId: null,
    scrapedAt: NOW.toISOString(),
    ...over,
  };
}

/** `HH:MM` on day `day` of September 2026, Warsaw time. */
const at = (day: number, hm: string) =>
  new Date(`2026-09-${String(day).padStart(2, '0')}T${hm}:00+02:00`).toISOString();

function section(events: Event[], over: Partial<BriefSection> = {}): BriefSection {
  return { category: 'cinema', windowDays: 1, detail: 'short', events, ...over };
}

/** Every entry the listing prints in full, plus the front page's. */
function fullEntries(issue: ReturnType<typeof buildAfiszkaIssue>): AfiszkaEntry[] {
  const front = [
    ...(issue.hero ? [issue.hero] : []),
    ...issue.morePicks,
    ...issue.closingSoon,
    ...issue.saved.map((s) => s.entry),
  ];
  const listing = issue.sections.flatMap((s) => s.entries).filter((e) => !isReferenced(issue, e));
  return [...front, ...listing];
}

describe('afiszka: descriptions (§2.5)', () => {
  const long = 'Pierwsze zdanie opisu filmu. Drugie zdanie, którego nie ma w wersji krótkiej.';

  it('short keeps the first sentence only', () => {
    expect(describeText(long, 'short')).toBe('Pierwsze zdanie opisu filmu.');
  });

  it('short cuts a long first sentence on a word boundary with an ellipsis', () => {
    const out = describeText(`${'słowo '.repeat(60)}koniec.`, 'short')!;
    expect(out.length).toBeLessThanOrEqual(161);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/\s…$/);
  });

  it('full keeps the whole text, and line keeps none', () => {
    expect(describeText(long, 'full')).toBe(long);
    expect(describeText(long, 'line')).toBeNull();
  });

  it('a missing description collapses rather than printing a placeholder', () => {
    expect(describeText(null, 'full')).toBeNull();
    expect(describeText('   ', 'short')).toBeNull();
  });
});

describe('afiszka: repeat shows (§1, §2.6)', () => {
  it('merges one title at one venue into a single entry with every date', () => {
    const events = [
      ev({ title: 'Ferdydurke', startsAt: at(8, '19:30'), venueId: 'ateneum', category: 'theatre' }),
      ev({ title: 'ferdydurke ', startsAt: at(10, '19:30'), venueId: 'ateneum', category: 'theatre', description: 'Dłuższy opis spektaklu.' }),
      ev({ title: 'Ferdydurke', startsAt: at(12, '19:30'), venueId: 'ateneum', category: 'theatre', description: 'Krótki.' }),
    ];
    const entries = buildEntries(section(events, { category: 'theatre', windowDays: 14 }), NOW, 14);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.occurrences).toHaveLength(3);
    // The longest description any copy carried.
    expect(entries[0]!.description).toBe('Dłuższy opis spektaklu.');
  });

  it('keeps the same film at two venues as two entries', () => {
    const events = [
      ev({ title: 'Parasite', startsAt: at(4, '20:00'), venueId: 'muranow' }),
      ev({ title: 'Parasite', startsAt: at(4, '20:00'), venueId: 'kinoteka' }),
    ];
    expect(buildEntries(section(events), NOW, 1)).toHaveLength(2);
  });

  it('writes a shared time once, and attaches differing times to each date', () => {
    expect(dateRun([at(8, '19:30'), at(10, '19:30'), at(12, '19:30')])).toBe('WT 8 · CZW 10 · SOB 12, 19:30');
    expect(dateRun([at(11, '19:00'), at(18, '21:00')])).toBe('PT 11 19:00 · PT 18 21:00');
  });
});

describe('afiszka: picks (§2.4)', () => {
  it('only premieres and openings are candidates', () => {
    expect(scorePick({ title: 'Sirât — premiera', exhibition: false, run: null }, NOW, 1)).toEqual({ kind: 'premiere' });
    expect(scorePick({ title: 'Parasite', exhibition: false, run: null }, NOW, 1)).toBeNull();
    expect(scorePick(
      { title: 'Soft Architecture', exhibition: true, run: { opens: at(8, '00:00'), closes: null } }, NOW, 7,
    )).toEqual({ kind: 'opening', at: at(8, '00:00') });
    expect(scorePick(
      { title: 'Old show', exhibition: true, run: { opens: at(1, '00:00'), closes: null } }, NOW, 7,
    )).toBeNull();
  });

  it('renders no picks at all when nothing is flagged — never filler', () => {
    const issue = buildAfiszkaIssue({
      sections: [section([
        ev({ title: 'Parasite', startsAt: at(4, '20:00') }),
        ev({ title: 'Odyseja', startsAt: at(4, '21:00') }),
      ])],
      fallbackFrequency: 'daily',
      now: NOW,
    });
    expect(issue.hero).toBeNull();
    expect(issue.morePicks).toEqual([]);
  });

  it('prefers an evening premiere for the hero, then up to three more', () => {
    const events = [
      ev({ title: 'Premiera A', startsAt: at(4, '12:00') }),
      ev({ title: 'Premiera B', startsAt: at(4, '19:00') }),
      ev({ title: 'Premiera C', startsAt: at(4, '16:00') }),
      ev({ title: 'Premiera D', startsAt: at(4, '17:00') }),
      ev({ title: 'Premiera E', startsAt: at(4, '17:30') }),
      ev({ title: 'Ordinary', startsAt: at(4, '18:00') }),
    ];
    const issue = buildAfiszkaIssue({ sections: [section(events)], fallbackFrequency: 'daily', now: NOW });
    expect(issue.hero?.title).toBe('Premiera B');
    expect(issue.morePicks.map((e) => e.title)).toEqual(['Premiera A', 'Premiera C', 'Premiera D']);
    const all = [issue.hero!, ...issue.morePicks];
    expect(all.every((e) => e.pick !== null)).toBe(true);
  });

  it('a saved pick shows once, in Want to go, not as a pick', () => {
    const premiere = ev({ title: 'Premiera', startsAt: at(4, '20:00') });
    const issue = buildAfiszkaIssue({
      sections: [section([premiere])],
      wantToGo: { reminders: [{ event: premiere, state: 'tomorrow' }], changes: [] },
      fallbackFrequency: 'daily',
      now: NOW,
    });
    expect(issue.hero).toBeNull();
    expect(issue.saved).toHaveLength(1);
  });
});

describe('afiszka: the one-entry rule (§2.2, §8)', () => {
  it('no event renders as a full entry more than once', () => {
    const saved = ev({ title: 'Saved film', startsAt: at(4, '18:00') });
    const events = [
      ev({ title: 'Premiera', startsAt: at(4, '20:00') }),
      ev({ title: 'Premiera', startsAt: at(4, '22:00') }),
      saved,
      ev({ title: 'Other', startsAt: at(4, '19:00') }),
      ev({ title: 'Other two', startsAt: at(4, '19:30') }),
    ];
    const issue = buildAfiszkaIssue({
      sections: [section(events)],
      wantToGo: { reminders: [{ event: saved, state: 'this_week' }], changes: [] },
      fallbackFrequency: 'daily',
      now: NOW,
    });
    const ids = fullEntries(issue).flatMap((e) => e.ids);
    expect(new Set(ids).size).toBe(ids.length);
    // …and the listing still mentions every event, if only as a reference.
    const listed = issue.sections.flatMap((s) => s.entries).flatMap((e) => e.ids);
    for (const e of events) expect(listed).toContain(e.id);
  });

  it('a show running across weeks appears once, in the week it opens', () => {
    const theatre = [
      ev({ title: 'Ferdydurke', startsAt: at(5, '19:00'), venueId: 'ateneum', category: 'theatre' }),
      ev({ title: 'Ferdydurke', startsAt: at(15, '19:00'), venueId: 'ateneum', category: 'theatre' }),
    ];
    const issue = buildAfiszkaIssue({
      sections: [section(theatre, { category: 'theatre', windowDays: 14 })],
      fallbackFrequency: 'weekly',
      now: NOW,
    });
    const block = issue.sections[0]!.blocks.find((b) => b.kind === 'weeks');
    expect(block?.kind).toBe('weeks');
    if (block?.kind !== 'weeks') return;
    const appearances = block.weeks.flatMap((w) => w.entries).filter((e) => e.title === 'Ferdydurke');
    expect(appearances).toHaveLength(1);
    expect(block.weeks[0]!.entries[0]!.occurrences).toHaveLength(2);
  });
});

describe('afiszka: listing layouts (§3.3, §4.3)', () => {
  it('lays an evening of films out in time bands, never more than three a band', () => {
    const films = ['A', 'B', 'C', 'D', 'E'].map((t, i) =>
      ev({ title: `Film ${t}`, startsAt: at(4, '20:15'), venueId: `v${i}` }));
    const issue = buildAfiszkaIssue({ sections: [section(films)], fallbackFrequency: 'daily', now: NOW });
    expect(isTimeBanded(issue.sections[0]!.entries)).toBe(true);
    const block = issue.sections[0]!.blocks.find((b) => b.kind === 'bands');
    if (block?.kind !== 'bands') throw new Error('expected bands');
    expect(block.bands.map((b) => b.cells.length)).toEqual([3, 2]);
    expect(block.bands.map((b) => b.label)).toEqual(['5 filmów · 1–3', '5 filmów · 4–5']);
  });

  it('puts exhibitions on a timeline and closes the soonest on the front of an outlook', () => {
    const runs = [
      ev({ title: 'Northern Light', startsAt: at(1, '00:00'), endsAt: at(9, '00:00'), kind: 'exhibition', category: 'exhibition', venueId: 'mnw' }),
      ev({ title: 'Long run', startsAt: at(1, '00:00'), endsAt: '2027-01-10T00:00:00Z', kind: 'exhibition', category: 'exhibition', venueId: 'csw' }),
    ];
    const issue = buildAfiszkaIssue({
      sections: [section(runs, { category: 'exhibition', windowDays: 7 })],
      fallbackFrequency: 'weekly',
      now: NOW,
    });
    expect(issue.kind).toBe('outlook');
    expect(issue.closingSoon.map((e) => e.title)).toEqual(['Northern Light']);
    expect(issue.sections[0]!.blocks[0]!.kind).toBe('timeline');
  });

  it('groups by venue in the reader\'s order when asked to (GOI-141)', () => {
    const events = [
      ev({ title: 'A', startsAt: at(4, '19:00'), venueId: 'muranow' }),
      ev({ title: 'B', startsAt: at(4, '20:00'), venueId: 'kinoteka' }),
      ev({ title: 'C', startsAt: at(4, '21:00'), venueId: 'iluzjon' }),
    ];
    const issue = buildAfiszkaIssue({
      sections: [section(events, { groupBy: 'venue', venueOrder: ['iluzjon', 'muranow'] })],
      fallbackFrequency: 'daily',
      now: NOW,
    });
    const block = issue.sections[0]!.blocks[0]!;
    if (block.kind !== 'venues') throw new Error('expected venues');
    // Named venues first, in the reader's order; the rest after.
    expect(block.venues.map((v) => v.name)).toEqual(['iluzjon', 'Kino Muranów', 'kinoteka']);
  });

  it('skips empty sections entirely', () => {
    const issue = buildAfiszkaIssue({
      sections: [section([]), section([ev({ title: 'X', startsAt: at(4, '20:00') })], { category: 'theatre' })],
      fallbackFrequency: 'daily',
      now: NOW,
    });
    expect(issue.sections.map((s) => s.category)).toEqual(['theatre']);
  });
});

describe('afiszka: rendering', () => {
  const content = {
    sections: [
      section([
        ev({ title: 'Sirât — premiera', startsAt: at(4, '22:35'), description: 'Film z Cannes.' }),
        ev({ title: 'Gorzkie święta', startsAt: at(4, '19:00'), description: 'Almodóvar & <b>więcej</b>.' }),
      ]),
    ],
    fallbackFrequency: 'daily' as const,
    recipientName: 'Ania',
    now: NOW,
  };

  it('draws the email with the masthead, the hero and escaped content', () => {
    const html = renderAfiszkaHtml(content);
    expect(html).toContain('AFISZ<span');
    expect(html).toContain('Dziś wieczorem — ten jeden'.toLocaleUpperCase('pl-PL'));
    expect(html).toContain('Almodóvar &amp; &lt;b&gt;więcej&lt;/b&gt;.');
    expect(html).not.toContain('<b>więcej</b>');
  });

  it('draws an A4 PDF', async () => {
    const pdf = await renderAfiszkaPdf(content);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    // Front page plus one listing sheet.
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length).toBe(2);
  });

  it('draws an empty issue without throwing', async () => {
    const empty = { sections: [], fallbackFrequency: 'weekly' as const, now: NOW };
    expect(renderAfiszkaHtml(empty)).toContain('nic nie znaleźliśmy');
    expect((await renderAfiszkaPdf(empty)).length).toBeGreaterThan(1000);
  });

  it('is chosen by the design setting, and classic stays the default', () => {
    expect(renderNewsletterHtml({ ...content, design: 'afiszka' })).toContain('AFISZ<span');
    expect(renderNewsletterHtml({ ...content, design: 'classic' })).not.toContain('AFISZ<span');
    expect(renderNewsletterHtml(content)).not.toContain('AFISZ<span');
  });
});

describe('afiszka: the design setting', () => {
  const base = { email: 'ania@example.com', sendCadence: 'daily', categoryRules: [{ category: 'cinema' }] };

  it('defaults to classic, so callers that predate it keep their look', () => {
    expect(newsletterSaveInput.parse(base).design).toBe('classic');
    expect(newsletterSaveInput.parse({ ...base, design: 'afiszka' }).design).toBe('afiszka');
    expect(newsletterSaveInput.safeParse({ ...base, design: 'fancy' }).success).toBe(false);
  });

  it('is stored and read back', async () => {
    const store = new InMemoryNewsletterStore();
    const saved = await store.save('u1', { ...newsletterSaveInput.parse(base), design: 'afiszka' });
    expect(saved.design).toBe('afiszka');
    expect((await store.getById('u1', saved.id))?.design).toBe('afiszka');
  });
});
