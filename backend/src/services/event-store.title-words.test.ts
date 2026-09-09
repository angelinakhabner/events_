import { describe, it, expect } from 'vitest';
import { wholeWordPattern } from './event-store.js';

/**
 * The pattern behind `titleWords` (GOI-112) — the predicate a *watch* on a
 * title uses.
 *
 * It is exercised here as a string, without a database, because everything
 * that can go wrong with it is in the string: a metacharacter that changes
 * what the regex means, and a boundary asserted at an end that has no word to
 * bound. The DB-backed suite then checks Postgres agrees.
 */
describe('wholeWordPattern', () => {
  it('bounds a title made of words at both ends', () => {
    expect(wholeWordPattern('Chungking Express')).toBe('\\yChungking Express\\y');
  });

  /**
   * The reason for the boundaries at all. Before the cross-venue search every
   * tracked title was copied off a real screening, so an exact match was both
   * right and safe. A title typed into a search box is neither: matched as a
   * plain substring, a tracked "It" is inside "Spirited Away" and "Little
   * Women", and a watch that runs unattended for months would report a
   * reader's own list back to them as news.
   */
  it('bounds a short title so it cannot hide inside longer words', () => {
    expect(wholeWordPattern('It')).toBe('\\yIt\\y');
  });

  /**
   * `\y` asserts a *transition*, so a boundary after the `%` of "100%" would
   * demand a word character right after it — and refuse the very title the
   * query was copied from.
   */
  it('leaves an end that is not a word unbounded', () => {
    expect(wholeWordPattern('100%')).toBe('\\y100%');
    expect(wholeWordPattern('%')).toBe('%');
    expect(wholeWordPattern('…and Justice for All')).toBe('…and Justice for All\\y');
  });

  /**
   * And leaves it off wherever the two engines might disagree about what a
   * word is. Postgres does not count the `½` of "8½" as alphanumeric; JavaScript's
   * `\p{N}` does. Asking for a boundary there would stop "8½" finding itself,
   * where leaving it off only makes the pattern looser — so where they differ,
   * this asks for less.
   */
  it('leaves an end off rather than anchor where Postgres would not', () => {
    expect(wholeWordPattern('8½')).toBe('\\y8½');
  });

  it('bounds a title that ends in a Polish letter', () => {
    expect(wholeWordPattern('Upadłe anioły')).toBe('\\yUpadłe anioły\\y');
  });

  /**
   * Every metacharacter in a tracked title is a character somebody typed. An
   * unescaped `(` is a syntax error Postgres raises — the watch would fail
   * rather than find nothing — and an unescaped `.` matches any letter.
   */
  it('escapes what a reader typed rather than running it as a regex', () => {
    expect(wholeWordPattern('Dogville (2003)')).toBe('\\yDogville \\(2003\\)');
    expect(wholeWordPattern('W.R.')).toBe('\\yW\\.R\\.');
  });
});
