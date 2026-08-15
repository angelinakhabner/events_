import { describe, it, expect } from 'vitest';
import { isPublicHost, normalizeVenueUrl, normalizedHref } from './normalize.js';

describe('normalizeVenueUrl (GOI-72 §1)', () => {
  // The reported bug: a bare host went into z.string().url(), which rejects it,
  // and "Invalid url" reached the UI verbatim.
  it('accepts the bare host from the bug report', () => {
    const res = normalizeVenueUrl('www.teatr-zydowski.art.pl');
    expect(res.ok && res.url.toString()).toBe('https://www.teatr-zydowski.art.pl/');
  });

  const table: [string, string][] = [
    ['teatr-zydowski.art.pl', 'https://teatr-zydowski.art.pl/'],
    ['  https://venue.example/program  ', 'https://venue.example/program'],
    ['"https://venue.example/program"', 'https://venue.example/program'],
    ['<https://venue.example/program>', 'https://venue.example/program'],
    ['HTTPS://VENUE.EXAMPLE/Program', 'https://venue.example/Program'],
    ['https://venue.example/program/', 'https://venue.example/program'],
    ['https://venue.example/', 'https://venue.example/'],
    ['https://venue.example/p#dzis', 'https://venue.example/p'],
    ['https://venue.example./p', 'https://venue.example/p'],
    ['http://venue.example/p', 'http://venue.example/p'],
  ];

  it.each(table)('normalizes %s', (input, expected) => {
    expect(normalizedHref(input)).toBe(expected);
  });

  it('strips campaign parameters but keeps the ones that select a page', () => {
    expect(normalizedHref('https://v.example/p?utm_source=fb&utm_medium=x&miesiac=2026-09'))
      .toBe('https://v.example/p?miesiac=2026-09');
    expect(normalizedHref('https://v.example/p?fbclid=abc&gclid=d&ref=e')).toBe('https://v.example/p');
  });

  it('drops credentials rather than forwarding them to the venue', () => {
    expect(normalizedHref('https://user:pass@venue.example/p')).toBe('https://venue.example/p');
  });

  it('gives the same key to spellings of one venue, so it dedupes', () => {
    const a = normalizedHref('teatr.example/repertuar');
    const b = normalizedHref('https://teatr.example/repertuar/');
    const c = normalizedHref('  HTTPS://Teatr.example/repertuar?utm_campaign=x#top ');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  // www. is deliberately NOT stripped — some hosts genuinely differ. The probe
  // stores the post-redirect URL instead.
  it('keeps www. as part of the identity', () => {
    expect(normalizedHref('https://www.teatr.example/')).not.toBe(normalizedHref('https://teatr.example/'));
  });

  it.each([
    'not a url at all',
    '',
    '   ',
    'ftp://venue.example/p',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://nodot/',
  ])('rejects %s as INVALID_URL', (input) => {
    const res = normalizeVenueUrl(input);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe('INVALID_URL');
  });

  it('refuses social pages by name, before any fetch is attempted', () => {
    for (const url of [
      'https://facebook.com/teatr',
      'https://www.facebook.com/teatr',
      'https://m.facebook.com/teatr',
      'fb.com/teatr',
      'https://instagram.com/teatr',
    ]) {
      const res = normalizeVenueUrl(url);
      expect(res.ok).toBe(false);
      expect(!res.ok && res.code).toBe('SOCIAL_ONLY');
    }
  });
});

describe('SSRF guard (GOI-72 §8)', () => {
  // The endpoint fetches arbitrary user input, so these must fail at
  // normalization — before a request exists to be made.
  it.each([
    'http://localhost:3000',
    'http://127.0.0.1',
    'http://192.168.1.1',
    'http://[::1]',
    'http://10.0.0.5/x',
    'http://172.16.0.1/x',
    'http://169.254.169.254/latest/meta-data/',
    'http://0.0.0.0',
    'http://100.64.0.1',
    'http://redis',
    'http://api.internal/x',
    'http://svc.local/x',
    'http://[fd00::1]',
    'http://[::ffff:127.0.0.1]',
    'http://LOCALHOST.',
  ])('rejects %s', (url) => {
    const res = normalizeVenueUrl(url);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe('INVALID_URL');
  });

  it('still allows ordinary public hosts', () => {
    for (const host of ['venue.example', 'www.teatr-zydowski.art.pl', 'teatr.com.pl', '8.8.8.8']) {
      expect(isPublicHost(host)).toBe(true);
    }
  });
});
