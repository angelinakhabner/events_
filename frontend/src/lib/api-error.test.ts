import { describe, it, expect } from 'vitest';
import { readableApiError } from './api-error';

/** The payload the newsletter form sends today, trimmed to the shape that
 *  matters here: which field names exist, and where. */
const sent = {
  email: 'a@b.com',
  sendCadence: 'weekly',
  sendWeekday: 1,
  categoryRules: [{ category: 'cinema', cadence: 'every_issue', detail: 'short' }],
  wantToGo: { enabled: true, horizonDays: 7 },
};

describe('readableApiError', () => {
  it('passes a plain message through', () => {
    expect(readableApiError('Email is not configured on this deployment'))
      .toBe('Email is not configured on this deployment');
  });

  it('returns null for no error', () => {
    expect(readableApiError(null)).toBeNull();
    expect(readableApiError('')).toBeNull();
  });

  it('turns a Zod issue dump into one line per problem', () => {
    const message = JSON.stringify([
      { path: ['sendWeekday'], message: 'A weekly newsletter needs a day of the week to go out on.' },
      { path: ['categoryRules', 1, 'cadence'], message: 'A weekly newsletter cannot carry a category once a week.' },
    ]);
    const out = readableApiError(message, sent);
    expect(out).toContain('Send weekday: A weekly newsletter needs a day of the week to go out on.');
    // One-based, so the index reads as the position a reader can count to.
    expect(out).toContain('Category rules 2 — cadence: A weekly newsletter cannot carry a category once a week.');
    expect(out).not.toContain('older build');
  });

  /** The failure this helper exists for: the API predates the form. */
  it('names a version mismatch when the API asks for fields the form has no idea about', () => {
    const message = JSON.stringify([
      { path: ['frequency'], message: 'Required' },
      { path: ['categoryRules', 1, 'frequency'], message: 'Required' },
    ]);
    const out = readableApiError(message, sent);
    expect(out).toContain('Frequency: Required');
    expect(out).toContain('older build than this page');
  });

  it('explains an unknown procedure as the same mismatch', () => {
    const out = readableApiError('No procedure found on path "my.newsletter.sendTest"');
    expect(out).toContain('my.newsletter.sendTest');
    expect(out).toContain('older build than this page');
  });

  it('does not cry version mismatch when it has no payload to compare against', () => {
    const message = JSON.stringify([{ path: ['frequency'], message: 'Required' }]);
    expect(readableApiError(message)).toBe('Frequency: Required');
  });

  it('keeps a message that only looks like JSON', () => {
    expect(readableApiError('[not json', sent)).toBe('[not json');
  });
});
