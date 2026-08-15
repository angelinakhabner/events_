import { describe, it, expect, beforeEach } from 'vitest';
import { PROBE_FREE_PER_HOUR, PROBE_PAID_PER_DAY, type ProbeOutcome } from '@afisz/shared';
import {
  PROBE_CACHE_TTL_MS,
  cacheProbe,
  cachedProbe,
  consumeQuota,
  resetProbeLimits,
} from './limits.js';
import { dateDensity, visibleText } from './heuristic.js';
import { allDatesPast } from './diagnose.js';

beforeEach(() => resetProbeLimits());

const outcome: ProbeOutcome = {
  status: 'failure',
  normalizedUrl: 'https://v.example/',
  code: 'NO_EVENTS_FOUND',
  severity: 'needs_decision',
  message: 'x',
};

describe('probe quotas (GOI-72 §7)', () => {
  it('allows the free allowance, then refuses — per user, not globally', () => {
    for (let i = 0; i < PROBE_FREE_PER_HOUR; i++) {
      expect(consumeQuota('alice', 'free')).toBe(true);
    }
    expect(consumeQuota('alice', 'free')).toBe(false);
    // Bob's allowance is his own.
    expect(consumeQuota('bob', 'free')).toBe(true);
  });

  it('counts paid probes separately, on a daily window', () => {
    for (let i = 0; i < PROBE_PAID_PER_DAY; i++) {
      expect(consumeQuota('alice', 'paid')).toBe(true);
    }
    expect(consumeQuota('alice', 'paid')).toBe(false);
    // Spending the paid allowance doesn't spend the free one.
    expect(consumeQuota('alice', 'free')).toBe(true);
  });

  it('lets the window slide rather than resetting on the hour', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < PROBE_FREE_PER_HOUR; i++) {
      expect(consumeQuota('alice', 'free', t0)).toBe(true);
    }
    expect(consumeQuota('alice', 'free', t0 + 59 * 60_000)).toBe(false);
    expect(consumeQuota('alice', 'free', t0 + 61 * 60_000)).toBe(true);
  });
});

describe('probe cache (GOI-72 §7)', () => {
  it('serves a result within the TTL so CHECK → ADD does not refetch', () => {
    const t0 = 5_000_000;
    cacheProbe('https://v.example/', outcome, t0);
    expect(cachedProbe('https://v.example/', t0 + 60_000)).toEqual(outcome);
  });

  it('expires it afterwards, so a fixed site is re-read', () => {
    const t0 = 5_000_000;
    cacheProbe('https://v.example/', outcome, t0);
    expect(cachedProbe('https://v.example/', t0 + PROBE_CACHE_TTL_MS + 1)).toBeNull();
  });

  it('misses on an unknown key', () => {
    expect(cachedProbe('https://other.example/')).toBeNull();
  });
});

describe('date-density heuristic (GOI-72 §3E)', () => {
  it('passes a Polish listing', () => {
    const text = '12 września, godz. 19:00 — Wesele. 13 września 18:30 Dziady.';
    expect(dateDensity(text, 'pl').pass).toBe(true);
  });

  it('passes an English listing', () => {
    expect(dateDensity('Friday 12 September, 7:00 pm — Hamlet', 'en').pass).toBe(true);
  });

  it('fails a menu, whatever the locale', () => {
    const menu = 'Żurek staropolski, kotlet schabowy, sernik wiedeński, kawa i herbata.';
    expect(dateDensity(menu, 'pl').pass).toBe(false);
    expect(dateDensity(menu, 'en').pass).toBe(false);
  });

  it('counts distinct matches, so a repeated footer year is one signal', () => {
    const repeated = Array.from({ length: 40 }, () => 'maja').join(' ');
    expect(dateDensity(repeated, 'pl').score).toBe(1);
    expect(dateDensity(repeated, 'pl').pass).toBe(false);
  });

  it('does not match a month name inside a longer word', () => {
    // "majonez" contains "maj"; "maja" must not match "majaczy".
    expect(dateDensity('majonez i majtki', 'pl').score).toBe(0);
  });

  it('reads only visible text — a date buried in a script tag is not content', () => {
    const html = '<html><body><script>var d="12 września 19:00";</script><p>Menu</p></body></html>';
    expect(dateDensity(visibleText(html), 'pl').pass).toBe(false);
  });
});

describe('allDatesPast (GOI-72 §3F)', () => {
  const now = new Date('2026-08-15T00:00:00Z');

  it('is true when every year on the page is behind us', () => {
    expect(allDatesPast('Archiwum 2019. Sezon 2018/2019.', now)).toBe(true);
  });

  it('is false when the current year appears', () => {
    expect(allDatesPast('Repertuar 2026. Archiwum 2019.', now)).toBe(false);
  });

  // A listing that writes "12 września" with no year must not be called an
  // archive on the strength of a copyright line alone.
  it('is false when the page carries no year at all', () => {
    expect(allDatesPast('12 września, godz. 19:00 — Wesele', now)).toBe(false);
  });
});
