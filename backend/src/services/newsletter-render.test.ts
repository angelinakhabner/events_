import { describe, it, expect } from 'vitest';
import type { Event, Festival } from '@afisz/shared';
import { groupPicks, listSentence, renderBriefHtml, type BriefSection } from './newsletter-render.js';

// A Wednesday noon in Warsaw (CEST = UTC+2).
const NOW = new Date('2026-07-22T10:00:00Z');

function makeEvent(over: Partial<Event> = {}): Event {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    venueId: 'v1',
    title: 'Some Film',
    description: null,
    startsAt: '2026-07-22T18:00:00+02:00',
    endsAt: null,
    category: 'cinema',
    language: null,
    director: null,
    cast: [],
    durationMinutes: null,
    priceMin: null,
    priceMax: null,
    sourceUrl: 'https://example.com/film',
    sourceId: null,
    scrapedAt: NOW.toISOString(),
    venue: { id: 'v1', name: 'Kinoteka', category: 'cinema', city: 'Warsaw', country: 'PL' },
    ...over,
  };
}

const FESTIVAL: Festival = {
  id: 'kino-letnie',
  name: 'Kino Letnie nad Wisłą',
  url: 'https://kinoletnie.pl',
  category: 'cinema',
  venues: ['Boulevards of the Vistula'],
  city: 'Warsaw',
  startDate: '2026-06-19',
  endDate: '2026-08-30',
  description: 'Open-air summer screenings on the Vistula boulevards — free entry, films at dusk.',
  imageUrl: null,
  status: 'ongoing',
};

/** A one-section brief — the shape most of these assertions care about. */
function section(over: Partial<BriefSection> = {}): BriefSection {
  return { category: '', windowDays: 1, detail: 'short', events: [makeEvent()], ...over };
}

function render(over: Partial<Parameters<typeof renderBriefHtml>[0]> = {}) {
  return renderBriefHtml({ sections: [section()], now: NOW, ...over });
}

/** The day-label rows only — the date also appears in the masthead and the
 *  preheader, so a bare string search can't tell those apart. `18px 0 0` is
 *  the day heading's own padding. */
function dayHeadings(html: string): string[] {
  return [...html.matchAll(/padding:18px 0 0;[^"]*">([^<]+)</g)].map((m) => m[1]!);
}

describe('renderBriefHtml — content', () => {
  it('renders the masthead, picks, festival and CTA', () => {
    const html = render({
      sections: [
        section({ category: 'cinema', events: [makeEvent({ title: 'Chungking Express', sourceUrl: 'https://x.pl/a' })] }),
        section({ category: 'comedy', events: [makeEvent({ title: 'Improv 101', category: 'comedy' })] }),
      ],
      recipientName: 'Ania',
      festival: FESTIVAL,
    });

    expect(html).toContain('AFISZ · DAILY');
    expect(html).toContain('Today in<br>Warsaw');
    expect(html).toContain('Hi Ania — 2 picks from Cinema &amp; Comedy');
    expect(html).toContain('Chungking Express');
    expect(html).toContain('https://x.pl/a');
    expect(html).toContain('KINOTEKA');
    expect(html).toContain('Kino Letnie nad Wisłą');
    expect(html).toContain('See all events in AFISZ →');
    expect(html).toContain('Manage preferences');
  });

  it('greets without a name when none is saved', () => {
    const html = render({ recipientName: null, sections: [section({ category: 'cinema' })] });
    expect(html).not.toContain('Hi ');
    expect(html).toContain('1 pick from Cinema');
  });

  it('switches the masthead and subject wording for weekly briefs', () => {
    const html = render({ sections: [section({ windowDays: 7 })] });
    expect(html).toContain('AFISZ · WEEKLY');
    expect(html).toContain('This week in<br>Warsaw');
  });

  it('labels each day in a weekly brief but not a daily one', () => {
    const events = [
      makeEvent({ title: 'Film A', startsAt: '2026-07-22T18:00:00+02:00' }),
      makeEvent({ title: 'Film B', startsAt: '2026-07-23T20:00:00+02:00' }),
    ];
    const weekly = render({ sections: [section({ windowDays: 7, events })] });
    expect(dayHeadings(weekly)).toEqual(['WED 22 JUL', 'THU 23 JUL']);

    // A daily brief is one day by definition — the design shows no day label.
    const daily = render({ sections: [section({ windowDays: 1, events: [events[0]!] })] });
    expect(dayHeadings(daily)).toEqual([]);
  });

  it('says so rather than sending an empty card when nothing is on', () => {
    const html = render({ sections: [] });
    expect(html).toContain('Nothing on in this window.');
  });

  it('omits the festival line when none is running', () => {
    expect(render({ festival: null })).not.toContain('Also on:');
  });

  it('escapes event text, including in the description and venue name', () => {
    const html = render({
      sections: [section({
        category: '<b>evil</b>',
        events: [makeEvent({
          title: '<script>alert(1)</script>',
          description: 'Tom & Jerry <b>live</b>',
          venue: { id: 'v', name: 'A & B', category: 'cinema', city: 'Warsaw', country: 'PL' },
        })],
      })],
      recipientName: '<img src=x>',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Tom &amp; Jerry');
    expect(html).toContain('A &amp; B');
  });

  it('trims a long description to one line', () => {
    const html = render({ sections: [section({ events: [makeEvent({ description: 'x'.repeat(400) })] })] });
    expect(html).toContain('…');
    expect(html).not.toContain('x'.repeat(200));
  });
});

// The design is only worth anything if it survives a mail client. These pin
// the properties that make it do so.
describe('renderBriefHtml — email safety', () => {
  const html = renderBriefHtml({
    sections: [section({
      category: 'cinema',
      events: [makeEvent(), makeEvent({ category: 'comedy', startsAt: '2026-07-22T20:00:00+02:00' })],
    })],
    recipientName: 'Ania',
    festival: FESTIVAL,
    now: NOW,
  });

  it('lays out with presentational tables, never flex or grid', () => {
    expect(html).toContain('role="presentation"');
    expect(html).not.toMatch(/display\s*:\s*(flex|grid)/);
  });

  it('inlines every style — no stylesheet, <style> block or webfont', () => {
    expect(html).not.toContain('<style');
    expect(html).not.toContain('<link');
    expect(html).not.toContain('@import');
    expect(html).not.toContain('fonts.googleapis');
  });

  it('uses no rgba() colours, which Outlook will not composite', () => {
    expect(html).not.toContain('rgba(');
  });

  it('gives the CTA a bgcolor attribute, not just a styled anchor', () => {
    expect(html).toMatch(/<td bgcolor="#1a1712"[^>]*>\s*<a /);
  });

  it('carries a hidden preheader and a color-scheme hint', () => {
    expect(html).toContain('mso-hide:all');
    expect(html).toContain('name="color-scheme"');
  });

  it('pins the card to the standard 600px email width', () => {
    expect(html).toContain(`width="600"`);
    expect(html).toContain('max-width:600px');
  });

  it('stays well under the ~100KB Gmail clipping threshold', () => {
    expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(100_000);
  });
});

describe('listSentence', () => {
  it('joins the way the design copy reads', () => {
    expect(listSentence(['Cinema'])).toBe('Cinema');
    expect(listSentence(['Cinema', 'Comedy'])).toBe('Cinema & Comedy');
    expect(listSentence(['Cinema', 'Comedy', 'Museums'])).toBe('Cinema, Comedy & Museums');
    expect(listSentence([])).toBe('');
  });
});

// GOI-36: one title, one day, several venues and times → one card.
describe('groupPicks', () => {
  const at = (iso: string, venue: string, over: Partial<Event> = {}) =>
    makeEvent({
      startsAt: iso,
      venue: { id: venue, name: venue, category: 'cinema', city: 'Warsaw', country: 'PL' },
      ...over,
    });

  it('collapses the same title on the same day across venues', () => {
    const picks = groupPicks([
      at('2026-07-22T20:30:00+02:00', 'Muranów'),
      at('2026-07-22T18:00:00+02:00', 'Kinoteka'),
    ]);
    expect(picks).toHaveLength(1);
    expect(picks[0]!.count).toBe(2);
    expect(picks[0]!.venues.map((v) => v.name)).toEqual(['Kinoteka', 'Muranów']);
  });

  it('orders venues by their first showing, not alphabetically', () => {
    const picks = groupPicks([
      at('2026-07-22T21:00:00+02:00', 'Atlantic'),
      at('2026-07-22T18:00:00+02:00', 'Zorza'),
    ]);
    expect(picks[0]!.venues.map((v) => v.name)).toEqual(['Zorza', 'Atlantic']);
  });

  it('collects several showings at one venue under that venue', () => {
    const picks = groupPicks([
      at('2026-07-22T14:00:00+02:00', 'Kinoteka'),
      at('2026-07-22T20:30:00+02:00', 'Kinoteka'),
      at('2026-07-22T18:00:00+02:00', 'Kinoteka'),
    ]);
    expect(picks).toHaveLength(1);
    expect(picks[0]!.count).toBe(3);
    expect(picks[0]!.venues).toHaveLength(1);
    expect(picks[0]!.venues[0]!.startsAt).toHaveLength(3);
    // Ascending, so the rendered time list reads chronologically.
    expect(picks[0]!.venues[0]!.startsAt[0]).toBe('2026-07-22T14:00:00+02:00');
  });

  it('keeps different days apart', () => {
    const picks = groupPicks([
      at('2026-07-22T18:00:00+02:00', 'Kinoteka'),
      at('2026-07-23T18:00:00+02:00', 'Kinoteka'),
    ]);
    expect(picks).toHaveLength(2);
  });

  it('groups by the Warsaw day, so a small-hours show joins its own evening', () => {
    // 23:00 and 00:30 are the same night out, but different UTC dates.
    const picks = groupPicks([
      at('2026-07-22T23:00:00+02:00', 'Kinoteka'),
      at('2026-07-22T22:30:00+02:00', 'Muranów'),
    ]);
    expect(picks).toHaveLength(1);
    // …while 00:30 the next morning is a different Warsaw day, and stays apart.
    expect(groupPicks([
      at('2026-07-22T23:00:00+02:00', 'Kinoteka'),
      at('2026-07-23T00:30:00+02:00', 'Muranów'),
    ])).toHaveLength(2);
  });

  it('matches titles case- and whitespace-insensitively', () => {
    // Different venues spell the same film differently in their markup.
    const picks = groupPicks([
      at('2026-07-22T18:00:00+02:00', 'Kinoteka', { title: 'Chungking Express' }),
      at('2026-07-22T20:00:00+02:00', 'Muranów', { title: '  chungking express ' }),
    ]);
    expect(picks).toHaveLength(1);
  });

  it('keeps genuinely different titles apart', () => {
    const picks = groupPicks([
      at('2026-07-22T18:00:00+02:00', 'Kinoteka', { title: 'Chungking Express' }),
      at('2026-07-22T20:00:00+02:00', 'Kinoteka', { title: 'Fallen Angels' }),
    ]);
    expect(picks).toHaveLength(2);
  });

  it('leads with the earliest showing and borrows a description from a later one', () => {
    // Enrichment is per-page, so one venue's listing may carry the blurb the
    // other's lacks. Dropping it because the earliest row is bare would lose
    // information the brief already has.
    const picks = groupPicks([
      at('2026-07-22T20:00:00+02:00', 'Muranów', { description: 'A Wong Kar-wai classic.' }),
      at('2026-07-22T18:00:00+02:00', 'Kinoteka', { description: null }),
    ]);
    expect(picks[0]!.startsAt).toBe('2026-07-22T18:00:00+02:00');
    expect(picks[0]!.lead.venue!.name).toBe('Kinoteka');
    expect(picks[0]!.lead.description).toBe('A Wong Kar-wai classic.');
  });

  it('sorts picks by first showing', () => {
    const picks = groupPicks([
      at('2026-07-22T21:00:00+02:00', 'Kinoteka', { title: 'Late' }),
      at('2026-07-22T12:00:00+02:00', 'Kinoteka', { title: 'Early' }),
    ]);
    expect(picks.map((p) => p.lead.title)).toEqual(['Early', 'Late']);
  });

  it('is a no-op on an ordinary one-showing list', () => {
    const picks = groupPicks([at('2026-07-22T18:00:00+02:00', 'Kinoteka')]);
    expect(picks).toHaveLength(1);
    expect(picks[0]!.count).toBe(1);
  });
});

describe('renderBriefHtml — aggregated picks (GOI-36)', () => {
  const at = (iso: string, venue: string, over: Partial<Event> = {}) =>
    makeEvent({
      startsAt: iso,
      venue: { id: venue, name: venue, category: 'cinema', city: 'Warsaw', country: 'PL' },
      ...over,
    });

  it('renders one card naming every venue and its times', () => {
    const html = render({
      sections: [section({
        events: [
          at('2026-07-22T18:00:00+02:00', 'Kinoteka', { title: 'Chungking Express' }),
          at('2026-07-22T20:30:00+02:00', 'Muranów', { title: 'Chungking Express' }),
        ],
      })],
    });
    // The title appears once, not once per venue.
    expect(html.match(/Chungking Express/g)).toHaveLength(1);
    expect(html).toContain('KINOTEKA 18:00 · MURANÓW 20:30');
    expect(html).toContain('2 shows');
  });

  it('counts cards, not showings, in the masthead', () => {
    const html = render({
      sections: [section({
        events: [
          at('2026-07-22T18:00:00+02:00', 'Kinoteka', { title: 'Same Film' }),
          at('2026-07-22T20:30:00+02:00', 'Muranów', { title: 'Same Film' }),
          at('2026-07-22T19:00:00+02:00', 'Zorza', { title: 'Another Film' }),
        ],
      })],
    });
    // Three screenings, two cards — saying "3 picks" would contradict the list.
    expect(html).toContain('2 picks');
    expect(html).not.toContain('3 picks');
  });

  it('leaves a single-venue pick reading exactly as before', () => {
    const html = render({
      sections: [section({ events: [at('2026-07-22T18:00:00+02:00', 'Kinoteka')] })],
    });
    expect(html).toContain('KINOTEKA');
    // No time repeated in the venue line, no count line.
    expect(html).not.toContain('KINOTEKA 18:00');
    expect(html).not.toContain('shows</div>');
    expect(html).toContain('1 pick');
  });

  it('keeps the same title on different days as separate cards in a weekly brief', () => {
    const html = render({
      sections: [section({
        windowDays: 7,
        events: [
          at('2026-07-22T18:00:00+02:00', 'Kinoteka', { title: 'Chungking Express' }),
          at('2026-07-24T18:00:00+02:00', 'Kinoteka', { title: 'Chungking Express' }),
        ],
      })],
    });
    expect(html.match(/Chungking Express/g)).toHaveLength(2);
    expect(dayHeadings(html)).toEqual(['WED 22 JUL', 'FRI 24 JUL']);
  });

  it('escapes venue names in the aggregated line', () => {
    const html = render({
      sections: [section({
        events: [
          at('2026-07-22T18:00:00+02:00', 'Kino <script>x</script>'),
          at('2026-07-22T20:00:00+02:00', 'Muranów'),
        ],
      })],
    });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;SCRIPT&gt;');
  });
});
