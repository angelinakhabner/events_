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

  it('returns undefined for hosts without a deterministic scraper', () => {
    expect(getDeterministicScraper('some-uuid', 'https://teatrdramatyczny.pl/repertuar/')).toBeUndefined();
    expect(getDeterministicScraper('some-uuid', 'not a url')).toBeUndefined();
    expect(getDeterministicScraper('some-uuid')).toBeUndefined();
  });
});
