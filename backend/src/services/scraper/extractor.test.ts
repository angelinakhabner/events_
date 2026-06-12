import { describe, it, expect, vi } from 'vitest';
import { parseJsonArray } from './extractor.js';

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
});
