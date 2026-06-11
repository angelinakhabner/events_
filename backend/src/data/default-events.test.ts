import { describe, it, expect } from 'vitest';
import { generateDefaultEvents } from './default-events.js';

// The fixed epoch the generator anchors to (2026-06-01T00:00:00Z).
const EPOCH = new Date('2026-06-01T00:00:00.000Z');

describe('generateDefaultEvents', () => {
  it('is deterministic for a given "now"', () => {
    const now = new Date('2026-07-15T12:00:00.000Z');
    expect(generateDefaultEvents(now)).toEqual(generateDefaultEvents(now));
  });

  it('produces one event per template with stable ids', () => {
    const events = generateDefaultEvents(EPOCH);
    expect(events).toHaveLength(9);
    expect(events.map((e) => e.id)).toEqual(
      Array.from({ length: 9 }, (_, i) => `evt-${i + 1}`),
    );
  });

  it('anchors to the fixed epoch when "now" is earlier', () => {
    const events = generateDefaultEvents(new Date('2020-01-01T00:00:00.000Z'));
    // First template: offsetDays 0, hour 18 → epoch day at 18:00 UTC.
    expect(events[0]!.startsAt).toBe('2026-06-01T18:00:00.000Z');
  });

  it('anchors to "now" (midnight UTC) when it is after the epoch', () => {
    const events = generateDefaultEvents(new Date('2026-07-15T09:30:00.000Z'));
    expect(events[0]!.startsAt).toBe('2026-07-15T18:00:00.000Z');
  });

  it('computes endsAt from durationMinutes, or null when unknown', () => {
    const events = generateDefaultEvents(EPOCH);
    const withDuration = events[0]!; // 124 min, starts 18:00
    expect(withDuration.endsAt).toBe('2026-06-01T20:04:00.000Z');
    const exhibition = events.find((e) => e.durationMinutes === null)!;
    expect(exhibition.endsAt).toBeNull();
  });

  it('links each event to its venue url', () => {
    const events = generateDefaultEvents(EPOCH);
    expect(events[0]!.link).toMatch(/^https?:\/\//);
  });
});
