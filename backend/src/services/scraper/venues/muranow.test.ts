import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMuranowCalendar, parseMonthLabel, scrapeMuranow } from './muranow.js';
import { validateEvents } from '../validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, '../../../../test/fixtures');
const TZ = 'Europe/Warsaw';
const BASE_URL = 'https://kinomuranow.pl/repertuar';

let html = '';
beforeAll(async () => {
  html = await fs.readFile(path.join(fixtureDir, 'muranow.html'), 'utf-8');
});

/** A Drupal AJAX reply shaped like the one the month pager returns. */
function ajaxReply(calendarHtml: string, newBuildId?: string): string {
  return JSON.stringify([
    { command: 'settings', settings: {}, merge: true },
    { command: 'insert', method: 'replaceWith', selector: '#calendar-wrapper', data: calendarHtml },
    ...(newBuildId ? [{ command: 'update_build_id', old: 'form-old', new: newBuildId }] : []),
  ]);
}

describe('parseMonthLabel', () => {
  it('reads the Polish month header off the calendar', () => {
    expect(parseMonthLabel(html)).toBe('2026-06');
  });

  it('returns null when the header is missing or unparseable', () => {
    expect(parseMonthLabel('<div>no calendar here</div>')).toBeNull();
    expect(
      parseMonthLabel('<span class="calendar-seance-full__month-label">Smarch 2026</span>'),
    ).toBeNull();
  });
});

describe('parseMuranowCalendar', () => {
  it('extracts every screening in the month', () => {
    expect(parseMuranowCalendar(html, TZ)).toHaveLength(143);
  });

  it('stamps showtimes with the cell date and the real Warsaw offset', () => {
    const events = parseMuranowCalendar(html, TZ);
    const tajny = events.find((e) => e.title === 'Tajny agent')!;
    expect(tajny.starts_at).toBe('2026-06-07T17:00:00+02:00');
    // Never a midnight placeholder — that's what the validator drops.
    expect(events.every((e) => !e.starts_at.includes('T00:00:00'))).toBe(true);
  });

  it('uses the film page as source_url and data-id as source_id', () => {
    const tajny = parseMuranowCalendar(html, TZ).find((e) => e.title === 'Tajny agent')!;
    expect(tajny.source_url).toBe('https://kinomuranow.pl/film/tajny-agent');
    expect(tajny.source_id).toBe('26919');
  });

  it('gives every row a per-film source_url, never the calendar fallback', () => {
    const events = parseMuranowCalendar(html, TZ);
    expect(events.every((e) => /\/film\//.test(e.source_url))).toBe(true);
    expect(events.every((e) => e.source_id !== null)).toBe(true);
  });

  it('leaves description null so the runner enriches from each film page', () => {
    expect(parseMuranowCalendar(html, TZ).every((e) => e.description === null)).toBe(true);
  });

  it('flags English-friendly screenings via the cycles blurb', () => {
    const flagged = parseMuranowCalendar(html, TZ).filter((e) => e.language === 'English friendly');
    expect(flagged.length).toBeGreaterThan(0);
    // Only the subtitled screenings — not every showing of those films.
    expect(flagged.length).toBeLessThan(143);
  });

  it('produces rows that all pass the cinema validator', () => {
    const { valid, invalid } = validateEvents(parseMuranowCalendar(html, TZ), {
      category: 'cinema',
      timezone: TZ,
    });
    expect(invalid).toHaveLength(0);
    expect(valid).toHaveLength(143);
  });

  it('trusts each cell month over the header, so grid spill-over lands correctly', () => {
    const spillover = `
      <span class="calendar-seance-full__month-label">Grudzień 2026</span>
      <div class="calendar-seance-full__day">
        <div class="cell-date-header">
          <span class="cell-date-header__day-num">31</span>
          <span class="cell-date-header__day-month-short">grudnia</span>
        </div>
        <div class="movie-calendar-info">
          <div class="movie-calendar-info__inner" data-id="1">
            <span class="movie-calendar-info__date">20:00</span>
            <h5 class="movie-calendar-info__title">Sylwester</h5>
          </div>
        </div>
      </div>
      <div class="calendar-seance-full__day">
        <div class="cell-date-header">
          <span class="cell-date-header__day-num">1</span>
          <span class="cell-date-header__day-month-short">stycznia</span>
        </div>
        <div class="movie-calendar-info">
          <div class="movie-calendar-info__inner" data-id="2">
            <span class="movie-calendar-info__date">12:00</span>
            <h5 class="movie-calendar-info__title">Nowy Rok</h5>
          </div>
        </div>
      </div>`;
    const events = parseMuranowCalendar(spillover, TZ);
    // The January cell rolls into the next year rather than back to 2026-01.
    expect(events.map((e) => e.starts_at)).toEqual([
      '2026-12-31T20:00:00+01:00',
      '2027-01-01T12:00:00+01:00',
    ]);
  });

  it('falls back to the passed month anchor when the header is absent', () => {
    const fragment = `
      <div class="calendar-seance-full__day">
        <div class="cell-date-header"><span class="cell-date-header__day-num">5</span></div>
        <div class="movie-calendar-info">
          <div class="movie-calendar-info__inner" data-id="9">
            <span class="movie-calendar-info__date">18:30</span>
            <h5 class="movie-calendar-info__title">Bez nagłówka</h5>
          </div>
        </div>
      </div>`;
    expect(parseMuranowCalendar(fragment, TZ, '2026-09')[0]!.starts_at).toBe(
      '2026-09-05T18:30:00+02:00',
    );
    // No header and no anchor → nothing, rather than a guessed date.
    expect(parseMuranowCalendar(fragment, TZ)).toEqual([]);
  });

  it('skips screenings missing a time or a title', () => {
    const broken = `
      <span class="calendar-seance-full__month-label">Czerwiec 2026</span>
      <div class="calendar-seance-full__day">
        <div class="cell-date-header"><span class="cell-date-header__day-num">7</span>
          <span class="cell-date-header__day-month-short">czerwca</span></div>
        <div class="movie-calendar-info">
          <div class="movie-calendar-info__inner" data-id="1">
            <h5 class="movie-calendar-info__title">Brak godziny</h5>
          </div>
        </div>
        <div class="movie-calendar-info">
          <div class="movie-calendar-info__inner" data-id="2">
            <span class="movie-calendar-info__date">19:00</span>
          </div>
        </div>
      </div>`;
    expect(parseMuranowCalendar(broken, TZ)).toEqual([]);
  });
});

describe('scrapeMuranow', () => {
  it('parses the base month and keeps only in-window screenings', async () => {
    const fetcher = (async () => new Response(html, { status: 200 })) as unknown as typeof fetch;

    const res = await scrapeMuranow({
      baseUrl: BASE_URL,
      today: new Date('2026-06-07T08:00:00Z'),
      windowDays: 7,
      timezone: TZ,
      fetcher,
    });

    const days = [...new Set(res.events.map((e) => e.starts_at.slice(0, 10)))].sort();
    expect(days[0]).toBe('2026-06-07');
    expect(days.at(-1)).toBe('2026-06-14');
    expect(res.events.length).toBeLessThan(143); // the rest of June is out of window
    expect(res.signature).toContain('2026-06');
  });

  it('walks the AJAX pager when the window crosses into the next month', async () => {
    // The pager returns a replacement #calendar-wrapper — here, early July.
    const july = `
      <div id="calendar-wrapper">
        <span class="calendar-seance-full__month-label">Lipiec 2026</span>
        ${[1, 3, 9].map((d) => `
          <div class="calendar-seance-full__day calendar-seance-full__day--filled">
            <div class="cell-date-header">
              <span class="cell-date-header__day-num">${d}</span>
              <span class="cell-date-header__day-month-short">lipca</span>
            </div>
            <div class="movie-calendar-info">
              <div class="movie-calendar-info__inner" data-id="7000${d}">
                <span class="movie-calendar-info__date">19:00</span>
                <h5 class="movie-calendar-info__title">Lipcowy seans ${d}</h5>
              </div>
              <div class="movie-calendar-info-expand">
                <a href="/film/lipcowy-${d}" class="movie-calendar-info-expand__thumb"></a>
              </div>
            </div>
          </div>`).join('')}
      </div>`;

    const calls: { url: string; method?: string; body?: string }[] = [];
    const fetcher = (async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, method: init?.method, body: init?.body as string | undefined });
      if (init?.method === 'POST') return new Response(ajaxReply(july, 'form-second'), { status: 200 });
      return new Response(html, { status: 200 });
    }) as unknown as typeof fetch;

    const res = await scrapeMuranow({
      baseUrl: BASE_URL,
      // 28 Jun + 7 days runs to 5 Jul, so July must be fetched.
      today: new Date('2026-06-28T08:00:00Z'),
      windowDays: 7,
      timezone: TZ,
      fetcher,
    });

    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('https://kinomuranow.pl/repertuar?ajax_form=1');
    // Replays the form's own build id and the pager button Drupal expects.
    expect(post.body).toContain('form_build_id=form-pophMfwur_aqyNvlkdRGmEqVrdh3COEJMNh');
    expect(post.body).toContain('_triggering_element_name=next_month_btn');
    expect(post.body).toContain('_drupal_ajax=1');

    const months = new Set(res.events.map((e) => e.starts_at.slice(0, 7)));
    expect([...months].sort()).toEqual(['2026-06', '2026-07']);
    const days = [...new Set(res.events.map((e) => e.starts_at.slice(0, 10)))].sort();
    expect(days[0]).toBe('2026-06-28');
    // 1 and 3 July are inside the window; 9 July is on the page but dropped.
    expect(days.at(-1)).toBe('2026-07-03');

    // Relative hrefs in the AJAX fragment are absolutized against the origin.
    const july1 = res.events.find((e) => e.title === 'Lipcowy seans 1')!;
    expect(july1.source_url).toBe('https://kinomuranow.pl/film/lipcowy-1');
  });

  it('does not touch the pager when the window stays inside the base month', async () => {
    const methods: (string | undefined)[] = [];
    const fetcher = (async (_u: string | URL, init?: RequestInit) => {
      methods.push(init?.method);
      return new Response(html, { status: 200 });
    }) as unknown as typeof fetch;

    await scrapeMuranow({
      baseUrl: BASE_URL,
      today: new Date('2026-06-07T08:00:00Z'),
      windowDays: 7,
      timezone: TZ,
      fetcher,
    });

    expect(methods.every((m) => m === undefined)).toBe(true);
  });

  it('keeps the base month when the pager hop fails', async () => {
    const fetcher = (async (_u: string | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response('nope', { status: 500 });
      return new Response(html, { status: 200 });
    }) as unknown as typeof fetch;

    const res = await scrapeMuranow({
      baseUrl: BASE_URL,
      today: new Date('2026-06-28T08:00:00Z'),
      windowDays: 7,
      timezone: TZ,
      fetcher,
    });

    // June's in-window screenings still land; July is simply missing.
    expect(res.events.length).toBeGreaterThan(0);
    expect(new Set(res.events.map((e) => e.starts_at.slice(0, 7)))).toEqual(new Set(['2026-06']));
  });

  it('survives an AJAX reply that carries no calendar markup', async () => {
    const fetcher = (async (_u: string | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify([{ command: 'settings' }]), { status: 200 });
      return new Response(html, { status: 200 });
    }) as unknown as typeof fetch;

    const res = await scrapeMuranow({
      baseUrl: BASE_URL,
      today: new Date('2026-06-28T08:00:00Z'),
      windowDays: 7,
      timezone: TZ,
      fetcher,
    });

    expect(new Set(res.events.map((e) => e.starts_at.slice(0, 7)))).toEqual(new Set(['2026-06']));
  });
});
