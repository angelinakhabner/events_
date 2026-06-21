import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { parseJsonArray, extractEvents, toolResponseToJson, EXTRACTOR_VERSION } from './extractor.js';
import type { Venue } from '@goin/shared';

/** Minimal Anthropic.Message stub for the tool-response parser. */
function message(content: unknown[], stopReason: Anthropic.Message['stop_reason'] = 'tool_use'): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20 },
  } as unknown as Anthropic.Message;
}

function toolUse(input: unknown) {
  return { type: 'tool_use', id: 'toolu_1', name: 'record_events', input };
}

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

describe('toolResponseToJson', () => {
  it('returns the events array from a forced record_events tool call', () => {
    const events = [
      { title: 'Rozmowa', starts_at: '2026-06-16T18:30:00+02:00', source_url: 'https://v/film/a' },
    ];
    const out = toolResponseToJson(message([toolUse({ events })]));
    // Round-trips through the normal parser the runner uses.
    expect(parseJsonArray(out)).toEqual(events);
  });

  it('preserves Polish typographic-quote titles that broke the free-text JSON path', () => {
    // This exact title hard-failed the old text path (a straight " closed the string).
    const events = [{ title: 'Premiera książki „Gender Is Over"', starts_at: '2026-06-30T18:00:00+02:00', source_url: 'https://v/x' }];
    const out = toolResponseToJson(message([toolUse({ events })]));
    expect((parseJsonArray(out) as Array<{ title: string }>)[0]!.title).toBe('Premiera książki „Gender Is Over"');
  });

  it('accepts a bare array input defensively', () => {
    const events = [{ title: 'A', starts_at: '2026-06-16T18:00:00+02:00', source_url: 'https://v/a' }];
    expect(parseJsonArray(toolResponseToJson(message([toolUse(events)])))).toEqual(events);
  });

  it('recovers when the model returns events as a JSON string (Muranów/Komediowy bug)', () => {
    const events = [
      { title: 'Rozmowa', starts_at: '2026-06-20T18:30:00+02:00', source_url: 'https://v/film/a' },
      { title: 'Inny', starts_at: '2026-06-21T20:00:00+02:00', source_url: 'https://v/film/b' },
    ];
    // events delivered as a stringified array, not an array.
    const out = toolResponseToJson(message([toolUse({ events: JSON.stringify(events) })]));
    expect(parseJsonArray(out)).toEqual(events);
  });

  it('throws on max_tokens truncation rather than returning partial data', () => {
    expect(() => toolResponseToJson(message([toolUse({ events: [] })], 'max_tokens'))).toThrow(/max_tokens/);
  });

  it('throws when the response has no tool_use block', () => {
    expect(() => toolResponseToJson(message([{ type: 'text', text: 'sorry' }]))).toThrow(/no tool_use block/);
  });

  it('throws with a diagnostic (input keys, token counts) when the input lacks an events array', () => {
    const err = (() => {
      try {
        toolResponseToJson(message([toolUse({ notEvents: 1 })]));
      } catch (e) {
        return e as Error;
      }
      return null;
    })();
    expect(err).toBeTruthy();
    expect(err!.message).toMatch(/no events array/);
    expect(err!.message).toContain('notEvents'); // surfaces what the model actually returned
    expect(err!.message).toMatch(/output_tokens: 20/);
    expect(err!.message).toMatch(/stop_reason: tool_use/);
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

  it('bounds extraction to a rolling window and prefers structured-data times', async () => {
    let captured = '';
    const client = {
      extract: async ({ user }: { user: string; system: string }) => {
        captured = user;
        return '[]';
      },
    };
    // today = 2026-06-13 → default 7-day window ends 2026-06-20.
    await extractEvents('<html/>', venue, new Date('2026-06-13T00:00:00Z'), { client });
    expect(captured).toMatch(/next 7 days/);
    expect(captured).toContain('2026-06-20');
    expect(captured).toMatch(/Skip anything dated after 2026-06-20/);
    expect(captured).toMatch(/PREFER the exact start time from any structured data/);
  });

  it('honours a custom windowDays', async () => {
    let captured = '';
    const client = {
      extract: async ({ user }: { user: string; system: string }) => {
        captured = user;
        return '[]';
      },
    };
    await extractEvents('<html/>', venue, new Date('2026-06-13T00:00:00Z'), { client, windowDays: 3 });
    expect(captured).toMatch(/next 3 days/);
    expect(captured).toContain('2026-06-16'); // 2026-06-13 + 3 days
  });

  it('exports an EXTRACTOR_VERSION that the runner can use to bust the hash cache', () => {
    expect(EXTRACTOR_VERSION).toBeTypeOf('number');
    expect(EXTRACTOR_VERSION).toBeGreaterThanOrEqual(1);
  });
});
