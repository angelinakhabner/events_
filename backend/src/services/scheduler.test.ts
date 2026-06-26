import { describe, it, expect, afterEach } from 'vitest';
import { msUntilNextWarsawHour, msUntilNextWarsawTime, isRetryableScrapeError, readVenueGapMs } from './scheduler.js';

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

describe('readVenueGapMs', () => {
  const originalValue = process.env.SCRAPE_VENUE_GAP_MS;
  afterEach(() => {
    if (originalValue === undefined) delete process.env.SCRAPE_VENUE_GAP_MS;
    else process.env.SCRAPE_VENUE_GAP_MS = originalValue;
  });

  it('defaults to 65000ms when the env var is unset', () => {
    delete process.env.SCRAPE_VENUE_GAP_MS;
    expect(readVenueGapMs()).toBe(65_000);
  });

  it('defaults to 65000ms when the env var is the empty string', () => {
    process.env.SCRAPE_VENUE_GAP_MS = '';
    expect(readVenueGapMs()).toBe(65_000);
  });

  it('defaults when the env var is non-numeric', () => {
    process.env.SCRAPE_VENUE_GAP_MS = 'abc';
    expect(readVenueGapMs()).toBe(65_000);
  });

  it('honours an explicit 0 to disable the gap', () => {
    process.env.SCRAPE_VENUE_GAP_MS = '0';
    expect(readVenueGapMs()).toBe(0);
  });

  it('parses a valid override', () => {
    process.env.SCRAPE_VENUE_GAP_MS = '120000';
    expect(readVenueGapMs()).toBe(120_000);
  });

  it('rejects negative values', () => {
    process.env.SCRAPE_VENUE_GAP_MS = '-5000';
    expect(readVenueGapMs()).toBe(65_000);
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

describe('msUntilNextWarsawTime (weekly cadence)', () => {
  it('with no dayOfWeek behaves identically to the daily helper', () => {
    const now = new Date('2026-06-11T20:00:00.000Z');
    expect(msUntilNextWarsawTime(7, undefined, now)).toBe(msUntilNextWarsawHour(7, now));
  });

  it('targets the next Monday 07:00 when run on a Friday', () => {
    // 2026-06-12T03:00:00Z = Fri 05:00 Warsaw. Next Mon 07:00 Warsaw =
    // 2026-06-15T05:00:00Z → 3 days + 2h = 74h away.
    const now = new Date('2026-06-12T03:00:00.000Z');
    expect(msUntilNextWarsawTime(7, 1, now)).toBe(74 * 3_600_000);
  });

  it('picks the same day when the target hour is still ahead', () => {
    // 2026-06-15T03:00:00Z = Mon 05:00 Warsaw. Today's 07:00 = 05:00 UTC → 2h.
    const now = new Date('2026-06-15T03:00:00.000Z');
    expect(msUntilNextWarsawTime(7, 1, now)).toBe(2 * 3_600_000);
  });

  it('rolls to next week when the target weekday/hour has just passed', () => {
    // 2026-06-15T06:00:00Z = Mon 08:00 Warsaw (past 07:00). Next Mon 07:00 =
    // 2026-06-22T05:00:00Z → 6 days + 23h = 167h away.
    const now = new Date('2026-06-15T06:00:00.000Z');
    expect(msUntilNextWarsawTime(7, 1, now)).toBe(167 * 3_600_000);
  });

  it('handles DST: weekly target stays on the Warsaw wall clock', () => {
    // Winter (CET, +01:00). 2026-01-15T20:00:00Z = Thu 21:00 Warsaw.
    // Next Monday is 2026-01-19; 07:00 Warsaw = 06:00 UTC.
    // From 2026-01-15T20:00Z to 2026-01-19T06:00Z = 3 days + 10h = 82h.
    const now = new Date('2026-01-15T20:00:00.000Z');
    expect(msUntilNextWarsawTime(7, 1, now)).toBe(82 * 3_600_000);
  });
});
