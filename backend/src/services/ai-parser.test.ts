import { describe, it, expect } from 'vitest';
import { extractJson } from './ai-parser.js';

describe('extractJson', () => {
  it('parses raw JSON', () => {
    expect(extractJson('[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it('parses JSON wrapped in a fenced code block', () => {
    const text = 'sure:\n```json\n[{"title":"x"}]\n```';
    expect(extractJson(text)).toEqual([{ title: 'x' }]);
  });
});
