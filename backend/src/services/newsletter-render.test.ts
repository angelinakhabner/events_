import { describe, it, expect } from 'vitest';
import type { Event, Festival } from '@goin/shared';
import { listSentence, renderBriefHtml, type BriefSection } from './newsletter-render.js';

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
  cinemas: ['Boulevards of the Vistula'],
  city: 'Warsaw',
  startDate: '2026-06-19',
  endDate: '2026-08-30',
  description: 'Open-air summer screenings on the Vistula boulevards — free entry, films at dusk.',
  status: 'ongoing',
};

/** A one-section brief — the shape most of these assertions care about. */
function section(over: Partial<BriefSection> = {}): BriefSection {
  return { category: '', frequency: 'daily', detail: 'short', events: [makeEvent()], ...over };
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

    expect(html).toContain('GOIN · DAILY');
    expect(html).toContain('Today in<br>Warsaw');
    expect(html).toContain('Hi Ania — 2 picks from Cinema &amp; Comedy');
    expect(html).toContain('Chungking Express');
    expect(html).toContain('https://x.pl/a');
    expect(html).toContain('KINOTEKA');
    expect(html).toContain('Kino Letnie nad Wisłą');
    expect(html).toContain('See all events in Goin →');
    expect(html).toContain('Manage preferences');
  });

  it('greets without a name when none is saved', () => {
    const html = render({ recipientName: null, sections: [section({ category: 'cinema' })] });
    expect(html).not.toContain('Hi ');
    expect(html).toContain('1 pick from Cinema');
  });

  it('switches the masthead and subject wording for weekly briefs', () => {
    const html = render({ sections: [section({ frequency: 'weekly' })] });
    expect(html).toContain('GOIN · WEEKLY');
    expect(html).toContain('This week in<br>Warsaw');
  });

  it('labels each day in a weekly brief but not a daily one', () => {
    const events = [
      makeEvent({ title: 'Film A', startsAt: '2026-07-22T18:00:00+02:00' }),
      makeEvent({ title: 'Film B', startsAt: '2026-07-23T20:00:00+02:00' }),
    ];
    const weekly = render({ sections: [section({ frequency: 'weekly', events })] });
    expect(dayHeadings(weekly)).toEqual(['WED 22 JUL', 'THU 23 JUL']);

    // A daily brief is one day by definition — the design shows no day label.
    const daily = render({ sections: [section({ frequency: 'daily', events: [events[0]!] })] });
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

describe('renderBriefHtml — unsubscribe footer (GOI-35)', () => {
  it('links the real one-click URL when one is supplied', () => {
    const html = render({
      sections: [section({ category: 'cinema', events: [makeEvent({})] })],
      unsubscribeUrl: 'https://goin.example/unsubscribe?token=abc123',
    });
    expect(html).toContain('>Unsubscribe</a>');
    expect(html).toContain('https://goin.example/unsubscribe?token=abc123');
  });

  it('escapes the URL rather than interpolating it raw', () => {
    const html = render({
      sections: [section({ category: 'cinema', events: [makeEvent({})] })],
      unsubscribeUrl: 'https://goin.example/unsubscribe?token=a"><script>x</script>',
    });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('drops the word entirely when there is no link, keeping "Manage preferences"', () => {
    // The preview has no recipient. Pointing "Unsubscribe" back at the
    // login-walled settings page — the old behaviour — made it a dead end.
    const html = render({ sections: [section({ category: 'cinema', events: [makeEvent({})] })] });
    expect(html).toContain('Manage preferences');
    expect(html).not.toContain('>Unsubscribe</a>');
  });
});
