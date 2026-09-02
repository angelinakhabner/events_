/**
 * Every combination of newsletter settings, through the real "Generate now"
 * path (GOI-105, second half).
 *
 * `frontend/src/lib/newsletter-payload.test.ts` walks the same product against
 * `newsletterSaveInput` and stops there: it proves the server *accepts* what
 * the form sends. Acceptance is only the first half of the button working.
 * `my.newsletter.preview` then selects the events, builds the sections,
 * renders an HTML document and renders a PDF — four more places a particular
 * combination can throw, none of which a schema test reaches. A brief that
 * validates and then dies in the renderer is, to the reader pressing the
 * button, the same bug they reported.
 *
 * So this walks the product through the procedure's own pipeline, minus the
 * one step that needs a database. The catalogue below stands in for
 * `listUpcoming`: 90 days of events, in each of the three venue categories, at
 * six times of day — wide enough that every lookahead, every time filter and
 * every cadence has both matches and non-matches to work with.
 *
 * The PDF is the slow step (~190 ms a render, which is minutes across the full
 * product), so the split is deliberate: the whole product goes through
 * selection, sections, subject and HTML, and a representative subset — every
 * detail level under every send cadence, plus the empty brief — also renders
 * the PDF. What the PDF renderer is sensitive to is the *shape* of a section,
 * not which lookahead produced it.
 */
import { describe, it, expect } from 'vitest';
import type {
  Event, NewsletterCategoryRule, NewsletterDelivery, NewsletterDetail,
  NewsletterSendCadence, NewsletterTimeFilter,
} from '@afisz/shared';
import { allowedRuleCadences, DEFAULT_WANT_TO_GO } from '@afisz/shared';
import { newsletterSaveInput } from './newsletter-input.js';
import {
  briefFetchWindowDays, briefSubject, buildBriefSections, dueSlot, plannedFrequency,
} from './newsletter.js';
import { renderBriefHtml } from './newsletter-render.js';
import { briefPdfFilename, renderBriefPdf } from './newsletter-pdf.js';
import type { UserVenue } from './user-venue-store.js';

/** A Wednesday noon in Warsaw (CEST = UTC+2) — so "weekly on Sunday" and
 *  "monthly on the 1st" are both a non-trivial distance away. */
const NOW = new Date('2026-07-22T10:00:00Z');

function venue(over: Partial<UserVenue>): UserVenue {
  return {
    id: 'v1', name: 'Kinoteka', category: 'cinema', city: 'Warsaw', country: 'PL',
    url: 'https://example.com', windowDays: null, customized: false, listId: null,
    tags: [], sourceMethod: null, probeErrorCode: null,
    ...over,
  } as UserVenue;
}

const VENUES: UserVenue[] = [
  venue({ id: 'v1', name: 'Kinoteka', category: 'cinema', tags: ['favourite'] }),
  venue({ id: 'v2', name: 'MSN', category: 'exhibition', tags: ['museum'] }),
  venue({ id: 'v3', name: 'Teatr Polski', category: 'theatre', tags: [] }),
];

const VENUE_CATEGORIES = [
  ['v1', 'cinema'], ['v2', 'exhibition'], ['v3', 'theatre'],
] as const;

/**
 * The catalogue `listUpcoming` would return, at its widest: out to 90 days —
 * the largest `lookaheadDays` the schema allows — across every venue, at
 * hours that straddle all four `after_NN` cutoffs.
 *
 * Sampled days rather than all ninety. Every window the settings can ask for
 * (1, 7, 30, 90 days, and the 1/7/30 the cadences derive) has events on both
 * sides of its edge, which is what the sweep is testing; the days in between
 * only add render time, and rendering is what makes the product slow.
 */
const CATALOGUE_DAYS = [0, 1, 2, 6, 7, 8, 13, 14, 29, 30, 31, 44, 60, 88, 89];

const EVENTS: Event[] = [];
for (const day of CATALOGUE_DAYS) {
  for (const [venueId, category] of VENUE_CATEGORIES) {
    for (const hour of [10, 17, 18, 19, 20, 21]) {
      const startsAt = new Date(NOW.getTime() + day * 86_400_000);
      startsAt.setUTCHours(hour - 2, 0, 0, 0); // Warsaw is UTC+2 in July
      EVENTS.push({
        id: `${venueId}-${day}-${hour}`,
        venueId,
        title: `${category} — day ${day}, ${hour}:00`,
        description: null,
        startsAt: startsAt.toISOString(),
        endsAt: null,
        category,
        language: null,
        director: null,
        cast: [],
        durationMinutes: null,
        priceMin: null,
        priceMax: null,
        sourceUrl: 'https://example.com/event',
        sourceId: null,
        scrapedAt: NOW.toISOString(),
        venue: {
          id: venueId,
          name: VENUES.find((v) => v.id === venueId)!.name,
          category,
          city: 'Warsaw',
          country: 'PL',
        },
      });
    }
  }
}

const SEND_CADENCES: NewsletterSendCadence[] = ['daily', 'weekly', 'monthly'];
const DETAILS: NewsletterDetail[] = ['line', 'short', 'full'];
const TIME_FILTERS: NewsletterTimeFilter[] = [
  'any', 'after_17', 'after_18', 'after_19', 'after_20',
];
const DELIVERIES: NewsletterDelivery[] = ['email', 'drive', 'both'];
/** null = "derive it from the cadence", plus the ends of the allowed range. */
const LOOKAHEADS: (number | null)[] = [null, 1, 7, 30, 90];

function rule(over: Partial<NewsletterCategoryRule> = {}): NewsletterCategoryRule {
  return {
    category: 'cinema',
    cadence: 'every_issue',
    cadenceWeekday: null,
    detail: 'short',
    timeFilter: 'any',
    lookaheadDays: null,
    sortOrder: 0,
    ...over,
  };
}

/** A request body in the shape the form posts, with the schedule field the
 *  cadence does not use nulled — exactly as `newsletterPayload` sends it. */
function body(
  sendCadence: NewsletterSendCadence,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    email: 'ania@example.com',
    recipientName: null,
    delivery: 'email',
    folderId: null,
    name: 'Newsletter',
    sendCadence,
    sendHour: 8,
    sendMinute: 0,
    sendWeekday: sendCadence === 'weekly' ? 1 : null,
    sendDayOfMonth: sendCadence === 'monthly' ? 1 : null,
    venueIds: [],
    categoryRules: [rule()],
    wantToGo: DEFAULT_WANT_TO_GO,
    enabled: true,
    ...over,
  };
}

interface Failure {
  /** Which step of the button's work broke — the thing a reader can't see. */
  where: 'schema' | 'sections' | 'html' | 'pdf';
  detail: string;
}

/**
 * What pressing "Generate now" does on the server, minus the database read.
 *
 * Mirrors `my.newsletter.preview` step for step: validate, work out the fetch
 * window, build the sections, render the HTML, render the PDF. Returns the
 * failure rather than throwing, so a sweep can report every broken
 * combination at once instead of stopping at the first.
 */
async function generate(
  raw: Record<string, unknown>,
  catalogue: Event[] = EVENTS,
  opts: { pdf?: boolean } = {},
): Promise<Failure | null> {
  const parsed = newsletterSaveInput.safeParse(raw);
  if (!parsed.success) {
    return {
      where: 'schema',
      detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }
  const input = parsed.data;
  try {
    briefFetchWindowDays(input, NOW);
    const sections = buildBriefSections(catalogue, input, VENUES, NOW);
    const brief = {
      sections,
      fallbackFrequency: plannedFrequency(input),
      recipientName: input.recipientName,
      festival: null,
      now: NOW,
    };
    briefSubject(sections);
    const html = renderBriefHtml(brief);
    if (!html.trimStart().startsWith('<!')) {
      return { where: 'html', detail: `not a document: ${html.slice(0, 60)}` };
    }
    if (opts.pdf) {
      briefPdfFilename(NOW, plannedFrequency(input));
      const pdf = await renderBriefPdf(brief);
      // `%PDF` and a plausible size: an empty buffer is the failure mode that
      // reaches the reader as a download that will not open.
      if (pdf.subarray(0, 4).toString() !== '%PDF' || pdf.length < 1000) {
        return { where: 'pdf', detail: `${pdf.length} bytes, header ${pdf.subarray(0, 4).toString()}` };
      }
    }
    return null;
  } catch (e) {
    return { where: 'sections', detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The first moment within `days` at which this schedule comes due, or null if
 * it never does. `dueSlot` is the same function the sweep calls every tick.
 *
 * Walks in half-hour steps, which is why the callers below all sit on the
 * hour: the scan has to be able to land on the send time, and a minute-fine
 * scan over forty days is millions of `Intl` formats.
 */
function firstSlotWithin(
  sub: Parameters<typeof dueSlot>[0] & { lastSentAt?: string | null },
  days: number,
): Date | null {
  const step = 30 * 60_000;
  for (let t = NOW.getTime(); t < NOW.getTime() + days * 86_400_000; t += step) {
    const slot = dueSlot(sub, new Date(t));
    if (slot) return slot;
  }
  return null;
}

describe('"Generate now" renders every combination of settings (GOI-105)', () => {
  /**
   * The full category-rule product under every send cadence: the rule
   * cadences the row actually offers × depth × time filter × lookahead ×
   * the weekday a weekly rule inside a daily brief carries.
   */
  it('renders every category rule the row can be set to', async () => {
    const broken: string[] = [];
    for (const sendCadence of SEND_CADENCES) {
      for (const cadence of allowedRuleCadences(sendCadence)) {
        for (const detail of DETAILS) {
          for (const timeFilter of TIME_FILTERS) {
            for (const lookaheadDays of LOOKAHEADS) {
              // null plus both ends of the picker: the weekday only chooses
              // which issue carries a weekly rule inside a daily brief, so
              // the middle of the range adds runtime and no coverage.
              for (const cadenceWeekday of [null, 0, 6]) {
                const failure = await generate(body(sendCadence, {
                  categoryRules: [
                    rule({ cadence, detail, timeFilter, lookaheadDays, cadenceWeekday }),
                  ],
                }));
                if (failure) {
                  broken.push(
                    `send=${sendCadence} rule=${cadence} detail=${detail} ` +
                    `time=${timeFilter} look=${lookaheadDays} wd=${cadenceWeekday} ` +
                    `→ [${failure.where}] ${failure.detail}`,
                  );
                }
              }
            }
          }
        }
      }
    }
    expect(broken).toEqual([]);
  }, 120_000);

  /**
   * The rest of the form: how many rules there are, which venues they draw
   * on, whether saved events ride along, and where the brief is delivered —
   * each against a full catalogue and an empty one.
   *
   * The empty catalogue is not a corner case. A reader who has just added
   * their venues has no events scraped yet, and "Generate now" on an empty
   * brief is the first thing they press.
   */
  it('renders every combination of rules, venues, saved events and delivery', async () => {
    const ruleSets: NewsletterCategoryRule[][] = [
      [],
      [rule({ category: 'cinema' })],
      // Tags, not categories — both name a section, and only the tag case
      // exercises `eventInCategory`'s second branch.
      [rule({ category: 'favourite' }), rule({ category: 'museum', sortOrder: 1 })],
      [
        rule({ category: 'cinema', detail: 'line' }),
        rule({ category: 'exhibition', detail: 'full', sortOrder: 1 }),
        rule({ category: 'theatre', detail: 'short', sortOrder: 2 }),
      ],
      // A rule that matches nothing: a section with no events still has to
      // render, or the brief dies on the reader's least interesting category.
      [rule({ category: 'nothing-matches-this' })],
    ];
    const venueSets: string[][] = [
      [], ['v1'], ['v1', 'v2'], ['v1', 'v2', 'v3'],
      // A venue the reader has since removed, still named in the saved config.
      ['deleted-venue'],
    ];

    const broken: string[] = [];
    for (const sendCadence of SEND_CADENCES) {
      for (const rules of ruleSets) {
        for (const venueIds of venueSets) {
          for (const wantToGoEnabled of [true, false]) {
            for (const delivery of DELIVERIES) {
              for (const catalogue of ['full', 'empty'] as const) {
                // Rule 4: no categories and no saved events is refused by the
                // schema, and the form disables both buttons for it
                // (`emptyByConstruction`). Asserted separately below.
                if (rules.length === 0 && !wantToGoEnabled) continue;
                const failure = await generate(body(sendCadence, {
                  categoryRules: rules,
                  venueIds,
                  delivery,
                  wantToGo: { ...DEFAULT_WANT_TO_GO, enabled: wantToGoEnabled },
                }), catalogue === 'empty' ? [] : EVENTS);
                if (failure) {
                  broken.push(
                    `send=${sendCadence} rules=${rules.map((r) => r.category).join('+') || 'none'} ` +
                    `venues=${venueIds.join('+') || 'all'} saved=${wantToGoEnabled} ` +
                    `delivery=${delivery} catalogue=${catalogue} ` +
                    `→ [${failure.where}] ${failure.detail}`,
                  );
                }
              }
            }
          }
        }
      }
    }
    expect(broken).toEqual([]);
  }, 120_000);

  /**
   * Every send time the two dropdowns can produce, on every cadence.
   *
   * Rendered against an empty catalogue on purpose. `buildBriefSections` is
   * never handed the send time — its schedule argument is the cadence and the
   * rules, nothing else — so re-selecting the catalogue for each of 648 clock
   * settings would re-test what the two sweeps above already cover, at
   * minutes a run. What *is* specific to the send time is the schedule, and
   * that is the next test.
   */
  it('renders at every send time, weekday and day of the month', async () => {
    const broken: string[] = [];
    for (const sendCadence of SEND_CADENCES) {
      for (let sendHour = 0; sendHour < 24; sendHour += 1) {
        for (const sendMinute of [0, 30, 59]) {
          for (const sendWeekday of [0, 1, 6]) {
            for (const sendDayOfMonth of [1, 15, 28]) {
              const failure = await generate(body(sendCadence, {
                sendHour,
                sendMinute,
                sendWeekday: sendCadence === 'weekly' ? sendWeekday : null,
                sendDayOfMonth: sendCadence === 'monthly' ? sendDayOfMonth : null,
              }), []);
              if (failure) {
                broken.push(
                  `${sendCadence} ${sendHour}:${sendMinute} wd=${sendWeekday} ` +
                  `dom=${sendDayOfMonth} → [${failure.where}] ${failure.detail}`,
                );
              }
            }
          }
        }
      }
    }
    expect(broken).toEqual([]);
  }, 120_000);

  /**
   * The other half of "Schedule newsletter": every schedule the form can save
   * has to actually come due.
   *
   * A brief that validates, saves and then never fires is the same bug as a
   * button that errors, only quieter — the reader finds out by the email not
   * arriving. Every weekday and every day of the month the pickers offer is
   * swept, which is where a schedule can fall through: `dueSlot` returns null
   * for a monthly issue on any day but its own, and the 28-day cap on the
   * picker is what stops "the 31st" from meaning "never in February".
   *
   * The hour is fixed at 08:00 — the scan steps in half hours, and the clock
   * only shifts a slot that the cadence has already decided exists. The full
   * hour × minute product goes through the test above.
   */
  it('comes due for every weekday and day of the month the pickers offer', () => {
    const never: string[] = [];
    const schedules: Record<string, unknown>[] = [body('daily', { sendHour: 8, sendMinute: 0 })];
    for (let sendWeekday = 0; sendWeekday <= 6; sendWeekday += 1) {
      schedules.push(body('weekly', { sendHour: 8, sendMinute: 0, sendWeekday }));
    }
    for (let sendDayOfMonth = 1; sendDayOfMonth <= 28; sendDayOfMonth += 1) {
      schedules.push(body('monthly', { sendHour: 8, sendMinute: 0, sendDayOfMonth }));
    }
    for (const raw of schedules) {
      const sub = newsletterSaveInput.parse(raw);
      // Forty days: long enough to contain a monthly issue on any of the 28
      // days the picker offers, from any starting day.
      if (!firstSlotWithin(sub, 40)) {
        never.push(`${sub.sendCadence} wd=${sub.sendWeekday} dom=${sub.sendDayOfMonth}`);
      }
    }
    expect(never).toEqual([]);
  }, 120_000);

  /**
   * The PDF, over the shapes it is actually sensitive to: every depth under
   * every send cadence, a multi-section brief, and a brief with nothing in
   * it. The PDF is what "Generate now" downloads, so a brief that renders as
   * HTML and fails here still reaches the reader as a broken button.
   */
  it('renders the PDF for every section shape', async () => {
    const broken: string[] = [];
    for (const sendCadence of SEND_CADENCES) {
      for (const detail of DETAILS) {
        for (const catalogue of ['full', 'empty'] as const) {
          const failure = await generate(
            body(sendCadence, { categoryRules: [rule({ detail })] }),
            catalogue === 'empty' ? [] : EVENTS,
            { pdf: true },
          );
          if (failure) {
            broken.push(`send=${sendCadence} detail=${detail} catalogue=${catalogue} → [${failure.where}] ${failure.detail}`);
          }
        }
      }
    }
    // Three sections at three depths in one document, which is where the
    // page-break handling has the most to do.
    const mixed = await generate(body('daily', {
      categoryRules: [
        rule({ category: 'cinema', detail: 'line', sortOrder: 0 }),
        rule({ category: 'exhibition', detail: 'full', cadence: 'weekly', cadenceWeekday: 4, sortOrder: 1 }),
        rule({ category: 'theatre', detail: 'short', cadence: 'monthly', sortOrder: 2 }),
      ],
    }), EVENTS, { pdf: true });
    if (mixed) broken.push(`mixed-depth brief → [${mixed.where}] ${mixed.detail}`);
    expect(broken).toEqual([]);
  }, 120_000);

  /**
   * The one configuration the server refuses, refused at the first step —
   * so the sweeps above cannot be quietly passing because nothing is checked.
   */
  it('refuses a brief with no categories and no saved events, before rendering', async () => {
    const failure = await generate(body('weekly', {
      categoryRules: [],
      wantToGo: { ...DEFAULT_WANT_TO_GO, enabled: false },
    }));
    expect(failure?.where).toBe('schema');
    expect(failure?.detail).toContain('categoryRules');
  });
});
