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
  url: null,
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

describe('renderBriefHtml — content', () => {
  it('renders the masthead, picks, festival and CTA', () => {
    const html = render({
      sections: [
        section({ category: 'cinema', events: [makeEvent({ title: 'Chungking Express', sourceUrl: 'https://x.pl/a' })] }),
        section({ category: 'comedy', events: [makeEvent({ title: 'Improv 101', category: 'comedy' })] }),
      ],
      recipientName: 'Ania',
      festivals: [FESTIVAL],
    });

    // The band names who it is from and what it covers; the arithmetic is the
    // line under it (GOI-110).
    expect(html).toContain('AFISZ.KA');
    expect(html).toContain('WARSZAWA');
    expect(html).toContain('Ania — 2 wydarzenia z Twoich 1 miejsca.');
    expect(html).toContain('Chungking Express');
    expect(html).toContain('https://x.pl/a');
    expect(html).toContain('KINOTEKA');
    expect(html).toContain('Kino Letnie nad Wisłą');
    expect(html).toContain('Zmień ustawienia');
    expect(html).toContain('Wypisz się');
  });

  it('greets without a name when none is saved', () => {
    const html = render({ recipientName: null, sections: [section({ category: 'cinema' })] });
    // Polish addresses someone in the vocative and an arbitrary name cannot be
    // declined reliably, so an unnamed brief simply states the count.
    expect(html).not.toContain(' — 1 wydarzenie');
    expect(html).toContain('1 wydarzenie z Twoich 1 miejsca.');
  });

  it('names the span the issue covers, not the cadence', () => {
    const daily = render({ sections: [section({ windowDays: 1 })] });
    const weekly = render({ sections: [section({ windowDays: 7 })] });
    // A single day is named outright; a span is written from–to.
    expect(daily).toMatch(/\d+ [A-ZŚŹŻĄĘŁÓŃĆ]+</i);
    expect(weekly).toMatch(/\d+–\d+ /);
  });

  /** GOI-110: the design dates the row, not the group — the day-heading rows
   *  the list used to be broken into are gone. */
  it('dates each row in a weekly brief but not in a daily one', () => {
    const events = [
      makeEvent({ title: 'Film A', startsAt: '2026-07-22T18:00:00+02:00' }),
      makeEvent({ title: 'Film B', startsAt: '2026-07-23T20:00:00+02:00' }),
    ];
    const weekly = render({ sections: [section({ windowDays: 7, events })] });
    expect(weekly).toContain('ŚR 22 VII');
    expect(weekly).toContain('CZW 23 VII');

    // A daily brief is one day by definition — the masthead already says which.
    const daily = render({ sections: [section({ windowDays: 1, events: [events[0]!] })] });
    expect(daily).not.toContain('ŚR 22 VII');
  });

  it('says so rather than sending an empty card when nothing is on', () => {
    const html = render({ sections: [] });
    expect(html).toContain('W tym tygodniu nic nie znaleźliśmy w Twoich miejscach.');
  });

  it('omits the festival band when nothing is on or opening soon', () => {
    expect(render({ festivals: [] })).not.toContain('FESTIWALE');
    expect(render({})).not.toContain('FESTIWALE');
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
    festivals: [FESTIVAL],
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

  /** GOI-110 dropped the CTA button: the footer already offers "open in
   *  AFISZ", and a full-width button saying the same thing above it was the
   *  same offer twice. What has to stay bulletproof is the ink band, which is
   *  a background colour on a `<td>` rather than a styled block. */
  it('paints the masthead band on a td, which every client fills', () => {
    // The band is a nested table inset by the card gutter rather than bled to
    // its edge, so the fill is on that table, not on the outer cell.
    expect(html).toMatch(/style="border-collapse:collapse;background-color:#1a1712"/);
    expect(html).not.toContain('See all events in AFISZ');
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
    // One line per venue, each with its own times — not one run-on string
    // that reads as a single place with four showings (GOI-110).
    expect(html).toContain('KINOTEKA · 18:00');
    expect(html).toContain('MURANÓW · 20:30');
    expect(html).not.toContain('KINOTEKA · 18:00 · MURANÓW');
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
    // Three screenings, two cards — saying "3" would contradict the list.
    expect(html).toContain('2 wydarzenia z Twoich');
    expect(html).not.toContain('3 wydarzenia z Twoich');
  });

  it('gives a single-venue pick the same one line as any other', () => {
    const html = render({
      sections: [section({ events: [at('2026-07-22T18:00:00+02:00', 'Kinoteka')] })],
    });
    // One venue, one line — the same shape an aggregated pick uses, so the
    // two do not read as different kinds of thing (GOI-110).
    expect(html).toContain('KINOTEKA · 18:00');
    expect(html).toContain('1 wydarzenie z Twoich');
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
    // Each card carries its own date now that the day headings are gone.
    expect(html).toContain('ŚR 22 VII');
    expect(html).toContain('PT 24 VII');
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

/**
 * The email redrawn to the design the PDF already carried (GOI-110).
 *
 * The cases below are the four things the ticket asked for by name, and each
 * is a thing the email did *not* do before: the saved queue grouped by state
 * at the top, festivals above the listings rather than at the foot, one line
 * per cinema, and a run dated by when it closes.
 */
/**
 * GOI-122: "museums" is one word for two different things — a run you can drop
 * in on any afternoon for the next six weeks, and a talk at seven on Thursday.
 * Listed together they read as one undifferentiated schedule.
 */
describe('renderBriefHtml — museums in two halves (GOI-122)', () => {
  const run = (title: string) =>
    makeEvent({
      title,
      kind: 'exhibition',
      startsAt: '2026-07-01T10:00:00+02:00',
      endsAt: '2026-09-14T18:00:00+02:00',
      venue: { id: 'z', name: 'Zachęta', category: 'exhibition', city: 'Warsaw', country: 'PL' },
    });
  const talk = (title: string, iso: string) =>
    makeEvent({
      title,
      startsAt: iso,
      venue: { id: 'z', name: 'Zachęta', category: 'exhibition', city: 'Warsaw', country: 'PL' },
    });

  const museums = (events: Event[]) =>
    render({ sections: [section({ category: 'exhibition', windowDays: 30, events })] });

  it('lists the runs, then what is on besides them', () => {
    const html = museums([
      talk('Oprowadzanie kuratorskie', '2026-08-05T18:00:00+02:00'),
      run('Formy nowoczesne'),
    ]);

    expect(html).toContain('WYSTAWY');
    expect(html).toContain('WYDARZENIA');
    expect(html.indexOf('WYDARZENIA')).toBeLessThan(html.indexOf('Oprowadzanie kuratorskie'));
    // Runs first: they answer "what is on at the museum", and the events are
    // what is on besides.
    expect(html.indexOf('Formy nowoczesne')).toBeLessThan(html.indexOf('WYDARZENIA'));
  });

  it('dates a run from when till when, and an event by day and time', () => {
    const html = museums([
      talk('Oprowadzanie kuratorskie', '2026-08-05T18:00:00+02:00'),
      run('Formy nowoczesne'),
    ]);

    expect(html).toContain('1 LIPCA – 14 WRZEŚNIA');
    // "5th Aug, Saturday", in the brief's own language — and the time leads it
    // in the gutter, since that is what the event asks a reader to turn up for.
    expect(html).toContain('5 SIERPNIA, ŚRODA');
    expect(html).toContain('18:00');
  });

  it('leaves a section of nothing but runs unsplit', () => {
    // A lone "WYSTAWY" subheading under the section's own heading would only
    // repeat it.
    const html = museums([run('Formy nowoczesne'), run('Nowa rzeźba')]);
    expect(html).not.toContain('WYDARZENIA');
    expect(html.split('WYSTAWY')).toHaveLength(2);
  });

  it('leaves every other category as one list', () => {
    const html = render({
      sections: [section({
        category: 'cinema',
        windowDays: 7,
        events: [makeEvent({ title: 'Chungking Express' })],
      })],
    });
    expect(html).not.toContain('WYDARZENIA');
  });
});

describe('renderBriefHtml — the redrawn brief (GOI-110)', () => {
  const cinema = (iso: string, venue: string, title: string) =>
    makeEvent({
      title,
      startsAt: iso,
      venue: { id: venue, name: venue, category: 'cinema', city: 'Warsaw', country: 'PL' },
    });

  it('puts the saved queue above the listings, grouped by state', () => {
    const html = render({
      sections: [section({ category: 'cinema', events: [cinema('2026-07-22T18:00:00+02:00', 'Kinoteka', 'A Film')] })],
      wantToGo: {
        changes: [],
        reminders: [
          { state: 'last_chance', event: makeEvent({ title: 'Closing Soon' }) },
          { state: 'tomorrow', event: makeEvent({ title: 'On Tomorrow' }) },
        ],
      } as never,
    });

    expect(html).toContain('WANT TO GO');
    expect(html).toContain('OSTATNIA SZANSA');
    expect(html).toContain('JUTRO');
    // The queue is the reader's own list, so it outranks the listing.
    expect(html.indexOf('WANT TO GO')).toBeLessThan(html.indexOf('A Film'));
    // And the states are separated rather than run together.
    expect(html.indexOf('OSTATNIA SZANSA')).toBeLessThan(html.indexOf('JUTRO'));
  });

  /**
   * The gutter no longer repeats the subheading.
   *
   * "ZMIANY" already labels the group, so a "ZMIANA" marker on every row under
   * it spent the one column that could say something the reader does not
   * already know. It carries the day the affected event falls on instead.
   */
  it('does not repeat the changes subheading in every row of the group', () => {
    const html = render({
      sections: [section({ category: 'cinema', events: [makeEvent({})] })],
      wantToGo: {
        reminders: [],
        changes: [{
          type: 'rescheduled',
          newValue: '2026-07-22T20:15:00+02:00',
          event: makeEvent({ title: 'Anatomia upadku', startsAt: '2026-07-22T17:30:00+02:00' }),
        }],
      } as never,
    });

    expect(html).toContain('ZMIANY');
    expect(html).not.toContain('>ZMIANA<');
    // The day is what the gutter says now, and the change itself still reads
    // in the meta line beside the venue.
    expect(html).toContain('ŚR');
    expect(html).toMatch(/PRZENIESIONY NA 20:15/);
  });

  it('raises festivals above the listings instead of trailing them', () => {
    const html = render({
      sections: [section({ category: 'cinema', events: [cinema('2026-07-22T18:00:00+02:00', 'Kinoteka', 'A Film')] })],
      festivals: [FESTIVAL],
    });

    expect(html).toContain('FESTIWALE');
    expect(html.indexOf('FESTIWALE')).toBeLessThan(html.indexOf('A Film'));
    // It used to be the last thing in the issue, under the button.
    expect(html).not.toContain('Also on:');
  });

  it('gives a film one line per cinema, each with that cinema’s own times', () => {
    const html = render({
      sections: [section({
        events: [
          cinema('2026-07-22T18:00:00+02:00', 'Kinoteka', 'Anatomia upadku'),
          cinema('2026-07-22T20:15:00+02:00', 'Muranów', 'Anatomia upadku'),
          cinema('2026-07-22T21:00:00+02:00', 'Muranów', 'Anatomia upadku'),
        ],
      })],
    });

    expect(html).toContain('KINOTEKA · 18:00');
    // Both of one venue's showings collapse onto that venue's own line.
    expect(html).toContain('MURANÓW · 20:15, 21:00');
    expect(html.match(/Anatomia upadku/g)).toHaveLength(1);
  });

  /** The gap the ticket names: the email printed an opening time for a run on
   *  until October, which is the one fact about it that does not matter. */
  it('dates an exhibition by its run, with no showtime', () => {
    const html = render({
      sections: [section({
        category: 'exhibition',
        events: [makeEvent({
          title: 'Formy nowoczesne',
          kind: 'exhibition',
          startsAt: '2026-07-01T10:00:00+02:00',
          endsAt: '2026-09-14T18:00:00+02:00',
          venue: { id: 'z', name: 'Zachęta', category: 'exhibition', city: 'Warsaw', country: 'PL' },
        })],
      })],
    });

    // From when till when (GOI-122): "do 14 września" alone says nothing about
    // whether the run has opened.
    expect(html).toContain('1 LIPCA – 14 WRZEŚNIA · ZACHĘTA');
    expect(html).toContain('Formy nowoczesne');
    // No gutter time, and no venue-and-times line of the timed kind.
    expect(html).not.toContain('ZACHĘTA · 10:00');
  });

  it('says only when it opened for a run with no closing date', () => {
    const html = render({
      sections: [section({
        category: 'exhibition',
        events: [makeEvent({
          title: 'Wystawa stała',
          kind: 'exhibition',
          endsAt: null,
          venue: { id: 'm', name: 'Muzeum Narodowe', category: 'exhibition', city: 'Warsaw', country: 'PL' },
        })],
      })],
    });

    expect(html).toContain('OD 22 LIPCA · MUZEUM NARODOWE');
    expect(html).not.toContain('DO ');
  });
});

/**
 * The masthead names the *issue's* span, not the widest section's (GOI-110).
 *
 * These are different numbers and only one of them is the issue. A weekly
 * brief carrying a monthly museums rule has a section reaching thirty days
 * out, and taking that as the span made the band read "10–8 WRZEŚNIA" — a
 * range whose month comes off an end date five weeks away, over an issue
 * covering a week. Caught by rendering the thing and looking at it.
 */
describe('renderBriefHtml — the span the masthead names (GOI-110)', () => {
  const monthly = section({ category: 'exhibition', windowDays: 30, events: [makeEvent({})] });
  const now = new Date('2026-08-10T09:00:00+02:00');

  it('follows the send cadence, not the longest section in the issue', () => {
    const html = render({ now, fallbackFrequency: 'weekly', sections: [monthly] });
    expect(html).toContain('10–16 SIERPNIA');
    expect(html).not.toContain('WRZEŚNIA');
  });

  it('names a single day outright for a daily brief', () => {
    const html = render({ now, fallbackFrequency: 'daily', sections: [monthly] });
    expect(html).toContain('10 SIERPNIA');
    expect(html).not.toContain('–');
  });

  it('reaches a month when the issue itself is monthly', () => {
    const html = render({ now, fallbackFrequency: 'monthly', sections: [monthly] });
    expect(html).toContain('10–8 WRZEŚNIA');
  });
});
