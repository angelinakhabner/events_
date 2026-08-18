import { describe, it, expect, vi } from 'vitest';
import {
  buildPrompt, dedupe, describeExemplars, suggestSimilarVenues, type SuggestedVenue,
} from './venue-suggest.js';

const exemplars = [
  { name: 'POLIN', city: 'Warsaw', category: 'exhibition', tags: ['history'] },
  { name: 'Zachęta', city: 'Warsaw', category: 'exhibition', tags: [] },
];

/** A well-formed suggestion; individual tests override one field at a time. */
const good = (over: Partial<SuggestedVenue> = {}): SuggestedVenue => ({
  name: 'Hamburger Bahnhof',
  url: 'https://www.smb.museum/hamburger-bahnhof',
  city: 'Berlin',
  country: 'DE',
  category: 'exhibition',
  why: 'A contemporary-art institution in a converted station, like Zachęta in scale.',
  ...over,
});

const replying = (payload: unknown) => vi.fn().mockResolvedValue(JSON.stringify(payload));

describe('describeExemplars', () => {
  it('lists each venue with its city, category and tags', () => {
    expect(describeExemplars(exemplars)).toContain('- POLIN (Warsaw, exhibition) [tags: history]');
  });

  it('omits the tag clause when there are none', () => {
    expect(describeExemplars(exemplars)).toContain('- Zachęta (Warsaw, exhibition)');
    expect(describeExemplars([exemplars[1]!])).not.toContain('tags:');
  });

  it('says so rather than rendering nothing for an empty folder', () => {
    expect(describeExemplars([])).toBe('(the folder is empty)');
  });
});

describe('buildPrompt', () => {
  it('carries the target city, the type and the exemplars', () => {
    const p = buildPrompt({ like: exemplars, city: 'Berlin', type: 'Museums', limit: 4 });
    expect(p).toContain('Target city: Berlin');
    expect(p).toContain('Type wanted: Museums');
    expect(p).toContain('POLIN');
    expect(p).toContain('up to 4 venues');
  });

  it('falls back to matching the examples when no type is given', () => {
    expect(buildPrompt({ like: exemplars, city: 'Berlin' })).toContain('anything matching the examples');
  });
});

describe('suggestSimilarVenues', () => {
  it('returns the parsed suggestions', async () => {
    const complete = replying([good()]);
    const out = await suggestSimilarVenues({ like: exemplars, city: 'Berlin', complete });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: 'Hamburger Bahnhof', city: 'Berlin', country: 'DE' });
  });

  it('reads JSON out of a fenced or chatty reply', async () => {
    const complete = vi.fn().mockResolvedValue(`Here you go:\n\`\`\`json\n${JSON.stringify([good()])}\n\`\`\``);
    await expect(suggestSimilarVenues({ like: exemplars, city: 'Berlin', complete })).resolves.toHaveLength(1);
  });

  it('upper-cases a lowercase country code', async () => {
    const complete = replying([good({ country: 'de' })]);
    const [only] = await suggestSimilarVenues({ like: exemplars, city: 'Berlin', complete });
    expect(only!.country).toBe('DE');
  });

  // One bad row in a batch must not cost the user the good ones.
  it('drops invalid entries but keeps the valid ones', async () => {
    const complete = replying([
      good(),
      { name: 'No URL here', city: 'Berlin', country: 'DE', category: 'exhibition', why: 'x' },
      good({ name: 'C/O Berlin', url: 'not-a-url' }),
    ]);
    const out = await suggestSimilarVenues({ like: exemplars, city: 'Berlin', complete });
    expect(out.map((s) => s.name)).toEqual(['Hamburger Bahnhof']);
  });

  it('rejects a category outside the offered set', async () => {
    const complete = replying([good({ category: 'restaurant' as never })]);
    await expect(suggestSimilarVenues({ like: exemplars, city: 'Berlin', complete })).rejects.toThrow(
      /none had a usable/,
    );
  });

  // An empty array is a legitimate "I have nothing for you"; a non-empty
  // array that parses to nothing is a failure worth surfacing.
  it('returns nothing for an empty list, without throwing', async () => {
    const complete = replying([]);
    await expect(suggestSimilarVenues({ like: exemplars, city: 'Berlin', complete })).resolves.toEqual([]);
  });

  it('throws when every row was unusable', async () => {
    const complete = replying([{ nonsense: true }]);
    await expect(suggestSimilarVenues({ like: exemplars, city: 'Berlin', complete })).rejects.toThrow(
      /none had a usable/,
    );
  });

  it('throws when the reply is not a list at all', async () => {
    const complete = vi.fn().mockResolvedValue('I could not find anything.');
    await expect(suggestSimilarVenues({ like: exemplars, city: 'Berlin', complete })).rejects.toThrow(
      /did not return a list/,
    );
  });

  it('honours the limit even if the model overshoots', async () => {
    const complete = replying([1, 2, 3, 4].map((n) => good({ name: `Venue ${n}`, url: `https://v${n}.example.com` })));
    const out = await suggestSimilarVenues({ like: exemplars, city: 'Berlin', limit: 2, complete });
    expect(out).toHaveLength(2);
  });

  it('requires a target city', async () => {
    await expect(
      suggestSimilarVenues({ like: exemplars, city: '   ', complete: replying([]) }),
    ).rejects.toThrow(/city is required/);
  });
});

describe('dedupe', () => {
  it('drops a suggestion the user already follows, by URL', () => {
    const out = dedupe([good()], [], ['https://www.smb.museum/hamburger-bahnhof']);
    expect(out).toHaveLength(0);
  });

  // The same venue is easily reached by two spellings of its address, so the
  // name+city match is the backstop.
  it('drops a suggestion the user already follows, by name and city', () => {
    const out = dedupe([good()], [{ name: 'hamburger bahnhof', city: 'BERLIN', category: 'exhibition' }], []);
    expect(out).toHaveLength(0);
  });

  it('drops a venue the model returned twice', () => {
    const out = dedupe([good(), good()], [], []);
    expect(out).toHaveLength(1);
  });

  it('keeps a genuinely new venue', () => {
    const out = dedupe([good()], [{ name: 'POLIN', city: 'Warsaw', category: 'exhibition' }], ['https://polin.pl']);
    expect(out).toHaveLength(1);
  });

  // Same venue, different address spelling — the URL keys must agree.
  it('treats trailing-slash and www variants as the same URL', () => {
    const out = dedupe([good({ url: 'https://www.smb.museum/hamburger-bahnhof/' })], [], [
      'https://www.smb.museum/hamburger-bahnhof',
    ]);
    expect(out).toHaveLength(0);
  });
});
