import { describe, it, expect } from 'vitest';
import { parseJsonLdEvents, parseIsoDurationMinutes } from './jsonld.js';

const OPTS = {
  pageUrl: 'https://venue.example/repertuar/',
  today: new Date('2026-07-02T10:00:00.000Z'),
  windowDays: 30,
};

const NODE = {
  '@type': 'TheaterEvent',
  name: '  Dziady  ',
  startDate: '2026-07-10T19:00:00+02:00',
  endDate: '2026-07-10T22:00:00+02:00',
  duration: 'PT2H45M',
  inLanguage: 'pl',
  director: { '@type': 'Person', name: 'Maja Kleczewska' },
  performer: [
    { '@type': 'Person', name: 'Aktor A' },
    { '@type': 'Person', name: 'Aktor B' },
  ],
  description: '<p>Wielka  inscenizacja.</p>',
  offers: { '@type': 'Offer', price: '60', priceCurrency: 'PLN' },
  url: '/spektakl/dziady/',
  '@id': 'https://venue.example/spektakl/dziady/#2026-07-10',
};

describe('parseJsonLdEvents', () => {
  it('maps a full schema.org event to the extractor row shape', () => {
    const [row] = parseJsonLdEvents([NODE], OPTS);
    expect(row).toEqual({
      title: 'Dziady',
      starts_at: '2026-07-10T19:00:00+02:00',
      duration_minutes: 165,
      language: 'pl',
      director: 'Maja Kleczewska',
      cast: ['Aktor A', 'Aktor B'],
      description: 'Wielka inscenizacja.',
      price_min: 6000,
      price_max: 6000,
      source_url: 'https://venue.example/spektakl/dziady/',
      source_id: 'https://venue.example/spektakl/dziady/#2026-07-10',
    });
  });

  it('nulls every optional field that is absent', () => {
    const [row] = parseJsonLdEvents(
      [{ '@type': 'ScreeningEvent', name: 'Film', startDate: '2026-07-05T18:00:00+02:00' }],
      OPTS,
    );
    expect(row).toMatchObject({
      title: 'Film',
      duration_minutes: null,
      language: null,
      director: null,
      cast: null,
      description: null,
      price_min: null,
      price_max: null,
      source_url: OPTS.pageUrl, // falls back to the listing page
      source_id: null,
    });
  });

  it('skips nodes missing a name or a parseable startDate', () => {
    const rows = parseJsonLdEvents(
      [
        { '@type': 'Event', startDate: '2026-07-05T18:00:00+02:00' }, // no name
        { '@type': 'Event', name: 'X', startDate: 'w przyszłym tygodniu' }, // free-text date
        { '@type': 'Event', name: 'OK', startDate: '2026-07-05T18:00:00+02:00' },
      ],
      OPTS,
    );
    expect(rows.map((r) => r.title)).toEqual(['OK']);
  });

  it('applies the scrape window: drops past and beyond-horizon events, keeps running ones', () => {
    const rows = parseJsonLdEvents(
      [
        { '@type': 'Event', name: 'Past', startDate: '2026-06-01T19:00:00+02:00' },
        { '@type': 'Event', name: 'Too far', startDate: '2026-09-01T19:00:00+02:00' },
        { '@type': 'Event', name: 'In window', startDate: '2026-07-20T19:00:00+02:00' },
        {
          '@type': 'ExhibitionEvent',
          name: 'Running exhibition',
          startDate: '2026-05-01T00:00:00+02:00',
          endDate: '2026-08-31T00:00:00+02:00',
        },
      ],
      OPTS,
    );
    expect(rows.map((r) => r.title)).toEqual(['In window', 'Running exhibition']);
  });

  it('ignores non-PLN prices and spans low/high across offers', () => {
    const rows = parseJsonLdEvents(
      [
        {
          '@type': 'Event',
          name: 'Koncert',
          startDate: '2026-07-05T20:00:00+02:00',
          offers: [
            { price: '40', priceCurrency: 'PLN' },
            { lowPrice: '30', highPrice: '90', priceCurrency: 'PLN' },
            { price: '25', priceCurrency: 'EUR' },
          ],
        },
      ],
      OPTS,
    );
    expect(rows[0]).toMatchObject({ price_min: 3000, price_max: 9000 });
  });
});

describe('parseIsoDurationMinutes', () => {
  it.each([
    ['PT2H', 120],
    ['PT1H30M', 90],
    ['PT105M', 105],
    ['P1DT2H', 1560],
    ['nonsense', null],
    [null, null],
  ])('%s → %s', (input, expected) => {
    expect(parseIsoDurationMinutes(input as string | null)).toBe(expected);
  });
});
