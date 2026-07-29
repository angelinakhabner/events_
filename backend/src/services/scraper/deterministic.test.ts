import { describe, it, expect } from 'vitest';
import { DETERMINISTIC_SCRAPERS, getDeterministicScraper } from './deterministic.js';

// Regression: production venue rows carry random UUIDs, not the
// DEFAULT_VENUES slugs — the registry must still resolve via the venue URL.
describe('getDeterministicScraper', () => {
  it('resolves by slug id (local scripts, tests)', () => {
    expect(getDeterministicScraper('kinoteka')).toBe(DETERMINISTIC_SCRAPERS.kinoteka);
  });

  it('resolves a UUID id by the venue URL host', () => {
    expect(
      getDeterministicScraper('5f233709-5782-4608-a4b2-0ba0efb80393', 'https://kinoteka.pl/repertuar/'),
    ).toBe(DETERMINISTIC_SCRAPERS.kinoteka);
  });

  it('handles www prefixes and URL-template placeholders in the path', () => {
    expect(
      getDeterministicScraper(
        'some-uuid',
        'https://www.mnw.art.pl/wydarzenia/kalendarz-wydarzen/{{MM-YYYY}},lista,miesiac.html',
      ),
    ).toBe(DETERMINISTIC_SCRAPERS['muzeum-narodowe']);
  });

  it('keeps Królikarnia (subdomain) distinct from MNW (parent domain)', () => {
    expect(
      getDeterministicScraper(
        'some-uuid',
        'https://krolikarnia.mnw.art.pl/wydarzenia/kalendarz-wydarzen/{{MM-YYYY}},lista,miesiac.html',
      ),
    ).toBe(DETERMINISTIC_SCRAPERS.krolikarnia);
  });

  it('resolves Muranów by host for DB rows carrying a UUID id', () => {
    expect(getDeterministicScraper('some-uuid', 'https://kinomuranow.pl/repertuar')).toBe(
      DETERMINISTIC_SCRAPERS['kino-muranow'],
    );
  });

  it('resolves Jassmine by host, whose slug id (jazzmine) differs from its domain', () => {
    expect(getDeterministicScraper('some-uuid', 'https://jassmine.com/koncerty/')).toBe(
      DETERMINISTIC_SCRAPERS.jazzmine,
    );
  });

  it('returns undefined for hosts without a deterministic scraper', () => {
    expect(getDeterministicScraper('some-uuid', 'https://teatrdramatyczny.pl/repertuar/')).toBeUndefined();
    expect(getDeterministicScraper('some-uuid', 'not a url')).toBeUndefined();
    expect(getDeterministicScraper('some-uuid')).toBeUndefined();
  });
});

// GOI-31: Zachęta joins the deterministic set. Its seeded URL changed with the
// scraper (0015), so both the id and the hostname must resolve.
it('resolves Zachęta by id and by hostname', () => {
  expect(getDeterministicScraper('zacheta')).toBe(DETERMINISTIC_SCRAPERS.zacheta);
  expect(
    getDeterministicScraper('0b8f8f6e-0000-4000-8000-000000000001', 'https://zacheta.art.pl/pl/kalendarz'),
  ).toBe(DETERMINISTIC_SCRAPERS.zacheta);
  // A row seeded before the migration still carries the old homepage URL.
  expect(
    getDeterministicScraper('0b8f8f6e-0000-4000-8000-000000000002', 'https://zacheta.art.pl/en'),
  ).toBe(DETERMINISTIC_SCRAPERS.zacheta);
});

// GOI-31: MSN joins the deterministic set. Its seeded URL lost its query
// string in the site rebuild, so both forms must resolve.
it('resolves MSN by id and by hostname', () => {
  expect(getDeterministicScraper('msn')).toBe(DETERMINISTIC_SCRAPERS.msn);
  expect(
    getDeterministicScraper('0b8f8f6e-0000-4000-8000-000000000003', 'https://artmuseum.pl/en/program-1'),
  ).toBe(DETERMINISTIC_SCRAPERS.msn);
  expect(
    getDeterministicScraper(
      '0b8f8f6e-0000-4000-8000-000000000004',
      'https://artmuseum.pl/en/program-1?from=2026-07-29&type=all',
    ),
  ).toBe(DETERMINISTIC_SCRAPERS.msn);
});
