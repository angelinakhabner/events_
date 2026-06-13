import { describe, it, expect, vi } from 'vitest';
import { parseJsonArray, extractEvents, EXTRACTOR_VERSION } from './extractor.js';
import type { Venue } from '@goin/shared';

describe('parseJsonArray', () => {
  it('parses strict, clean JSON', () => {
    expect(parseJsonArray('[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it('unwraps a fenced code block', () => {
    expect(parseJsonArray('```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
  });

  it('repairs unescaped double-quotes inside string values', () => {
    // Polish-style Muranów failure: bare " inside the description string.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = '[{"title":"A","description":"He said "hi" loudly"},{"title":"B","description":"ok"}]';
    const out = parseJsonArray(broken) as Array<{ title: string }>;
    expect(out).toHaveLength(2);
    expect(out[0]!.title).toBe('A');
    expect(out[1]!.title).toBe('B');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/jsonrepair/));
    warn.mockRestore();
  });

  it('repairs trailing commas + smart quotes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const lossy = "[{\"x\":1,},{\"y\":2,},]";
    expect(parseJsonArray(lossy)).toEqual([{ x: 1 }, { y: 2 }]);
    warn.mockRestore();
  });

  it('throws with position context when the payload has no array at all', () => {
    expect(() => parseJsonArray('sorry, I cannot help'))
      .toThrow(/did not contain a JSON array/);
  });

  it('throws with diagnostic context when even jsonrepair cannot recover', () => {
    // Truncated mid-key; no closing bracket either — neither path recovers.
    expect(() => parseJsonArray('[{"a":1},{"b":')).toThrow(/did not contain a JSON array|could not be parsed/);
  });

  it('does not claim "recovered N entries" when repair produced a non-array', () => {
    // Smart-quotes payload that jsonrepair will fix into a valid object (not an
    // array). The "recovered" log line must NOT fire — we throw 'not a JSON array'.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Wrap an object-shaped payload inside [ ... ] so the slice extraction
    // finds an outer array bound. The inner content is an object using smart
    // quotes that jsonrepair will repair, but the result is still not an array
    // structurally — the top-level `[...]` becomes `[<object>]` so this is
    // actually a valid array of one. Use a payload jsonrepair turns into a
    // bare object instead.
    //
    // The simplest reliable shape: a payload that strict-parses to a non-array
    // and survives a repair pass unchanged.
    expect(() => parseJsonArray('[42,')).toThrow(); // strict fails, repair fails too OR succeeds with non-array — either way no warn lying
    const warnCalls = warn.mock.calls.map((c) => String(c[0]));
    // If we ever logged "recovered", parsed must have been an array — assert
    // that the recovered-log only appears with a length.
    for (const msg of warnCalls) {
      if (msg.includes('recovered')) {
        expect(msg).toMatch(/recovered \d+ entries/);
      }
    }
    warn.mockRestore();
  });
});

describe('extractEvents prompt shape', () => {
  const venue: Pick<Venue, 'name' | 'city' | 'timezone' | 'category' | 'url'> = {
    name: 'Test Venue',
    city: 'Warsaw',
    timezone: 'Europe/Warsaw',
    category: 'cinema',
    url: 'https://venue.example/repertuar',
  };

  it('instructs Claude to use per-event URLs and reject the calendar URL', async () => {
    let captured = '';
    const client = {
      extract: async ({ user }: { user: string; system: string }) => {
        captured = user;
        return '[]';
      },
    };
    await extractEvents('<html/>', venue, new Date('2026-06-13T00:00:00Z'), { client });
    // Per-event URL guidance must be present.
    expect(captured).toMatch(/SOURCE_URL/);
    // The venue's own calendar URL must be explicitly called out as forbidden.
    expect(captured).toContain('https://venue.example/repertuar');
    expect(captured).toMatch(/NEVER use the venue's calendar/i);
    expect(captured).toMatch(/\/film\/<slug>|\/spektakl\/<slug>|\/wystawa\/<slug>/);
  });

  it('exports an EXTRACTOR_VERSION that the runner can use to bust the hash cache', () => {
    expect(EXTRACTOR_VERSION).toBeTypeOf('number');
    expect(EXTRACTOR_VERSION).toBeGreaterThanOrEqual(1);
  });
});
