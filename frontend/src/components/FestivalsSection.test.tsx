import { describe, it, expect } from 'vitest';
import { formatRange } from './FestivalsSection';

describe('formatRange', () => {
  it('collapses same-month ranges', () => {
    expect(formatRange('2026-10-09', '2026-10-18')).toBe('9–18 Oct');
  });

  it('spells out cross-month ranges', () => {
    expect(formatRange('2026-06-19', '2026-08-30')).toBe('19 Jun – 30 Aug');
  });

  it('shows a single day once', () => {
    expect(formatRange('2026-11-11', '2026-11-11')).toBe('11 Nov');
  });
});
