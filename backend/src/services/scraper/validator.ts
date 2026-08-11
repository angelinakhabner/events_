import { z } from 'zod';

/**
 * Schema for one extractor output row (matches the Claude prompt schema).
 *
 * `kind` splits the two things a venue page can list (GOI-67): a screening or
 * performance at a clock time, and an exhibition that runs over a date range.
 * The invariants below are what stop an exhibition from being stored with a
 * fabricated hour — the bug this schema change exists to end. They are checked
 * here *and* by a check constraint on the table, because the extractor is a
 * language model and the DB is the last line that can't be talked out of it.
 */
const EventFields = z.object({
  title: z.string().min(1).transform(normalizeTitle),
  kind: z
    .enum(['timed', 'exhibition'])
    .nullable()
    .optional()
    // Rows from a venue-specific deterministic scraper (and every fixture
    // written before GOI-67) omit the field; those are all timed listings.
    .transform((v) => v ?? 'timed'),
  starts_at: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'invalid ISO timestamp'),
  /** Closing date of an exhibition run. Null for a timed event. */
  ends_at: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), 'invalid ISO timestamp')
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  duration_minutes: z.number().int().positive().nullable(),
  language: z.string().min(1).nullable(),
  director: z.string().min(1).nullable(),
  cast: z.array(z.string()).nullable(),
  description: z.string().nullable(),
  price_min: z.number().int().nonnegative().nullable(),
  price_max: z.number().int().nonnegative().nullable(),
  source_url: z.string().url(),
  source_id: z.string().min(1).nullable().optional().transform((v) => v ?? null),
});

export const EventSchema = EventFields.superRefine((e, ctx) => {
  if (e.kind === 'exhibition') {
    if (e.ends_at === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ends_at'],
        message: 'an exhibition must carry ends_at (its closing date)',
      });
      return;
    }
    if (Date.parse(e.ends_at) < Date.parse(e.starts_at)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ends_at'],
        message: 'exhibition ends_at is before starts_at',
      });
    }
    return;
  }
  // A timed row with a closing date is an exhibition the model failed to
  // label; taking it at its word would put a months-long run in the "Later
  // today" bucket at whatever hour it guessed.
  if (e.ends_at !== null && !sameLocalDay(e.starts_at, e.ends_at)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ends_at'],
      message: 'a timed event may not span days — label it kind="exhibition"',
    });
  }
});

export type ValidatedEvent = z.infer<typeof EventSchema>;

export interface ValidationResult {
  valid: ValidatedEvent[];
  invalid: { entry: unknown; error: string }[];
}

export interface ValidateOptions {
  /** Venue category — drives the all-day vs timed start-time rule. */
  category?: string;
  /** Venue timezone for resolving the local wall-clock of starts_at. */
  timezone?: string;
}

/**
 * Categories whose events legitimately have no clock time (all-day). For these
 * a local-midnight start is fine; for everything else (cinema, theatre, comedy,
 * concert…) a 00:00 start almost always means the extractor couldn't find the
 * real showtime and defaulted to midnight — which is worse than dropping the
 * row, because it surfaces a confidently-wrong time to users.
 */
const ALL_DAY_CATEGORIES = new Set(['exhibition']);

export function validateEvents(raw: unknown, opts: ValidateOptions = {}): ValidationResult {
  const out: ValidationResult = { valid: [], invalid: [] };
  if (!Array.isArray(raw)) {
    return { valid: [], invalid: [{ entry: raw, error: 'top-level value is not an array' }] };
  }
  for (const entry of raw) {
    const parsed = EventSchema.safeParse(entry);
    if (!parsed.success) {
      out.invalid.push({ entry, error: parsed.error.message });
      continue;
    }
    // An exhibition is *expected* to sit at midnight — that's what "no clock
    // time" looks like once it's a timestamp — so the midnight heuristic only
    // applies to rows claiming to be timed.
    if (parsed.data.kind === 'timed' && isSuspectMidnight(parsed.data.starts_at, opts)) {
      out.invalid.push({
        entry,
        error: 'starts_at is local midnight for a timed venue — likely a missing showtime, not a real 00:00 start',
      });
      continue;
    }
    out.valid.push(parsed.data);
  }
  return out;
}

/** True when starts_at lands exactly on 00:00 local time for a timed venue. */
function isSuspectMidnight(iso: string, opts: ValidateOptions): boolean {
  const { category, timezone } = opts;
  if (!category || ALL_DAY_CATEGORIES.has(category)) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone || 'Europe/Warsaw',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23', // 00..23 — avoids the '24:00' midnight quirk of hour12:false
  }).formatToParts(d);
  const hour = parts.find((p) => p.type === 'hour')?.value;
  const minute = parts.find((p) => p.type === 'minute')?.value;
  return hour === '00' && minute === '00';
}

/** Whether two instants fall on the same UTC calendar day. Deliberately not
 *  venue-local: this only has to catch multi-day spans, and a run mislabelled
 *  as timed is days or months long, never an hour either side of midnight. */
function sameLocalDay(a: string, b: string): boolean {
  return new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);
}

/** Trim and collapse internal whitespace. Preserves Polish diacritics. */
function normalizeTitle(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
