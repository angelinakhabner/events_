import { describe, it, expect } from 'vitest';
import { msUntilNextWarsawHour, isRetryableScrapeError } from './scheduler.js';

describe('isRetryableScrapeError', () => {
  it('retries on out-of-credits (the message the SDK surfaces for a 400)', () => {
    const msg =
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}';
    expect(isRetryableScrapeError(msg)).toBe(true);
  });

  it('retries on rate limit (429) and overloaded (529)', () => {
    expect(isRetryableScrapeError('429 {"error":{"type":"rate_limit_error"}}')).toBe(true);
    expect(isRetryableScrapeError('529 {"error":{"type":"overloaded_error"}}')).toBe(true);
  });

  it('does NOT retry real bugs (changed HTML / bad parse / generic 400)', () => {
    expect(isRetryableScrapeError('Extractor response did not contain a JSON array')).toBe(false);
    expect(isRetryableScrapeError('AI returned invalid event payload: ...')).toBe(false);
    expect(isRetryableScrapeError('400 {"error":{"type":"invalid_request_error","message":"max_tokens too large"}}')).toBe(false);
  });

  it('handles null / empty messages', () => {
    expect(isRetryableScrapeError(null)).toBe(false);
    expect(isRetryableScrapeError(undefined)).toBe(false);
    expect(isRetryableScrapeError('')).toBe(false);
  });
});

describe('msUntilNextWarsawHour', () => {
  it('targets 07:00 CEST (05:00 UTC) in summer', () => {
    // 2026-06-11T20:00:00Z = 22:00 Warsaw (CEST, +02:00).
    // Next 07:00 Warsaw = 2026-06-12T05:00:00Z → 9h away.
    const now = new Date('2026-06-11T20:00:00.000Z');
    expect(msUntilNextWarsawHour(7, now)).toBe(9 * 3_600_000);
  });

  it('targets 07:00 CET (06:00 UTC) in winter', () => {
    // 2026-01-15T20:00:00Z = 21:00 Warsaw (CET, +01:00).
    // Next 07:00 Warsaw = 2026-01-16T06:00:00Z → 10h away.
    const now = new Date('2026-01-15T20:00:00.000Z');
    expect(msUntilNextWarsawHour(7, now)).toBe(10 * 3_600_000);
  });

  it('picks later today when the target hour is still ahead', () => {
    // 2026-06-12T03:00:00Z = 05:00 Warsaw. 07:00 Warsaw = 05:00 UTC → 2h away.
    const now = new Date('2026-06-12T03:00:00.000Z');
    expect(msUntilNextWarsawHour(7, now)).toBe(2 * 3_600_000);
  });

  it('never returns zero or negative', () => {
    // Exactly at the target moment → next day.
    const now = new Date('2026-06-12T05:00:00.000Z'); // 07:00 Warsaw
    const ms = msUntilNextWarsawHour(7, now);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(24 * 3_600_000);
  });
});
